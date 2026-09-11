using System.Diagnostics;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class EncodeGridResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public List<EncodeGridPoint> Points { get; init; } = [];
}

/// <summary>
/// Sweeps resolution × CRF, measuring real bitrate and full-reference VMAF for each sample.
/// The resulting RD points are what <see cref="LadderDerivation"/> builds a ladder from.
/// </summary>
/// <remarks>
/// Two phases. A coarse pass samples every resolution at the recipe's CRFs, then refinement spends
/// the remaining budget where the ladder will actually be read off: past the grid's edge when a
/// tangent point lies beyond it, just under each crossover that caps a rung, at each crossover
/// itself, and next to a selected rung when the curve is still too coarse there. The provisional
/// ladder it aims at comes from the same pure <see cref="LadderDerivation.Plan"/> the final
/// derivation uses, so refinement cannot aim anywhere other than where the ladder is taken from.
/// The earlier refinement bisected towards a fixed VMAF 85–95 band, which 480p and below never
/// reach — their extra samples all landed below VMAF 40, where no rung is ever chosen.
/// </remarks>
public sealed class EncodeGrid {
    internal const int MaxSamplesPerResolution = 10;
    internal const int MaxSamplesTotal = 45;
    internal const int LowestCrf = 12;
    internal const int HighestCrf = 51;

    /// <summary>Quality gap next to a selected rung wide enough to justify another encode.</summary>
    private const double MaxQualityGap = 2.5;

    /// <summary>A capped rung is sampled this far under its crossover, so the sample lands inside the window.</summary>
    private const double CapTargetFraction = 0.97;

    private readonly Transcoder _transcoder;
    private readonly VmafAnalyzer _vmaf;
    private readonly MediaProbe _probe;
    private readonly AnalysisStore _store;
    private readonly ILogger<EncodeGrid> _logger;

    public EncodeGrid(
        Transcoder transcoder,
        VmafAnalyzer vmaf,
        MediaProbe probe,
        AnalysisStore store,
        ILogger<EncodeGrid> logger) {
        _transcoder = transcoder;
        _vmaf = vmaf;
        _probe = probe;
        _store = store;
        _logger = logger;
    }

    public async Task<EncodeGridResult> RunAsync(
        string routeId,
        Guid staticTranscodeId,
        string sourcePath,
        EncodeRecipe recipe,
        double cambiPenaltyWeight = 0,
        string sectionId = "encodeGrid",
        Func<int, int, CancellationToken, Task>? onProgress = null,
        CancellationToken cancellationToken = default) {
        var points = new List<EncodeGridPoint>();
        var tempRoot = NewTempDir("encode-grid");

        try {
            var reference = await ResolveReferenceResolutionAsync(sourcePath, cancellationToken);
            if (reference == null) {
                return new EncodeGridResult {
                    Success = false,
                    ErrorMessage = "Could not read source resolution for encode grid"
                };
            }

            var variants = TranscodeProfile.Default.Variants;
            var done = 0;

            // Upper bound while refinement is still deciding how many samples it needs; it settles
            // to the real count at the end.
            var total = Math.Max(variants.Count * recipe.CoarseCrfs.Length, MaxSamplesTotal);

            if (onProgress != null) {
                await onProgress(done, total, cancellationToken);
            }

            // CRF-outer, so every few samples span every resolution. The pass costs the same in any
            // order, but this one keeps the running time per sample representative for the time
            // estimate — resolution-outer front-loads every 1080p encode.
            foreach (var crf in recipe.CoarseCrfs) {
                foreach (var variant in variants) {
                    cancellationToken.ThrowIfCancellationRequested();
                    points.Add(await SampleAsync(
                        sourcePath, tempRoot, variant, crf, reference.Value, recipe, cambiPenaltyWeight, cancellationToken));
                    await ReportAsync(onProgress, ++done, total, cancellationToken);
                }
            }

            while (points.Count < MaxSamplesTotal) {
                var plan = LadderDerivation.Plan(points);
                if (plan.Error != null) {
                    break;
                }

                var next = NextTargets(points, plan, variants)
                    .FirstOrDefault(target => points.Count(point => point.Height == target.Height) < MaxSamplesPerResolution);

                if (next == null) {
                    break;
                }

                cancellationToken.ThrowIfCancellationRequested();
                _logger.LogInformation(
                    "Encode grid refinement{Suffix}: {Label} CRF{Crf} — {Reason}",
                    recipe.Tune == null ? "" : $" [{recipe.Tune}]",
                    next.Variant.Label,
                    next.Crf,
                    next.Reason);

                points.Add(await SampleAsync(
                    sourcePath, tempRoot, next.Variant, next.Crf, reference.Value, recipe, cambiPenaltyWeight, cancellationToken));
                await ReportAsync(onProgress, ++done, total, cancellationToken);
            }

            await ReportAsync(onProgress, done, done, cancellationToken);

            points = points
                .OrderByDescending(point => point.Height)
                .ThenBy(point => point.Crf)
                .ToList();

            var succeeded = points.Any(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0);

            var animation = sectionId != "encodeGrid";
            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                animation
                    ? new AnalysisSeriesDocument { EncodeGridAnimation = points }
                    : new AnalysisSeriesDocument { EncodeGrid = points },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(points, recipe, sectionId),
                cancellationToken);

            return new EncodeGridResult {
                Success = succeeded,
                ErrorMessage = succeeded ? null : "No successful encode-grid points",
                Points = points
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Encode grid failed for {RouteId}", routeId);
            return new EncodeGridResult {
                Success = false,
                ErrorMessage = ex.Message,
                Points = points
            };
        } finally {
            TryDeleteDirectory(tempRoot, _logger);
        }
    }

    /// <summary>A sample the refinement wants, in priority order (lower first).</summary>
    internal sealed record GridTarget(TranscodeVariant Variant, int Height, int Crf, int Priority, string Reason);

    /// <summary>
    /// Where the next samples are worth spending, given the current provisional ladder.
    /// </summary>
    /// <remarks>
    /// Priority 1 — a rung at the grid's lowest CRF with the hull still steeper than λ: extend below.
    /// Priority 2 — a rung capped by a crossover, or a resolution with no sample inside its window:
    /// sample just under the cap (that sample usually becomes the rung).
    /// Priority 3 — each crossover: sample the resolution taking over, and extend the lower one
    /// when the crossover lies past its last sample.
    /// Priority 4 — a quality gap next to a selected rung.
    /// Targets predicted to fall below the quality floor, outside the CRF range, or already
    /// sampled are skipped.
    /// </remarks>
    internal static List<GridTarget> NextTargets(
        IReadOnlyList<EncodeGridPoint> points,
        LadderDerivation.LadderPlan plan,
        IReadOnlyList<TranscodeVariant> variants) {
        var ok = points.Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0).ToList();
        var sampled = points.Select(point => (point.Height, point.Crf)).ToHashSet();
        var variantByHeight = variants
            .Select(variant => (Variant: variant, Height: ParseResolution(variant.Resolution)?.Height ?? 0))
            .Where(item => item.Height > 0)
            .GroupBy(item => item.Height)
            .ToDictionary(group => group.Key, group => group.First().Variant);

        var targets = new List<GridTarget>();

        List<EncodeGridPoint> SamplesAt(int height) =>
            ok.Where(point => point.Height == height).OrderBy(point => point.Crf).ToList();

        void Add(int height, int? crf, int priority, string reason) {
            if (crf == null || !variantByHeight.TryGetValue(height, out var variant)) {
                return;
            }

            var value = Math.Clamp(crf.Value, LowestCrf, HighestCrf);
            if (sampled.Contains((height, value))) {
                return;
            }

            if (PredictQuality(SamplesAt(height), value) is { } predicted && predicted < LadderDerivation.QualityFloor) {
                return;
            }

            targets.Add(new GridTarget(variant, height, value, priority, reason));
        }

        foreach (var rung in plan.Rungs) {
            var height = rung.Hull.Height;
            var samples = SamplesAt(height);
            if (samples.Count == 0) {
                continue;
            }

            if (rung.AtGridBoundary) {
                var minCrf = samples.Min(point => point.Crf);
                var extended = sampled.Contains((height, minCrf - 4)) ? minCrf - 2 : minCrf - 4;
                Add(height, extended, 1, "tangent point lies past the grid's lowest CRF");
            }

            if (rung.Capped && rung.CapBps is { } cap) {
                Add(height, CrfForRate(samples, cap * CapTargetFraction), 2, "just under the crossover that caps this rung");
            }

            var index = samples.FindIndex(point => ReferenceEquals(point, rung.Point));
            if (index < 0) {
                continue;
            }

            foreach (var neighbourIndex in new[] { index - 1, index + 1 }) {
                if (neighbourIndex < 0 || neighbourIndex >= samples.Count) {
                    continue;
                }

                var neighbour = samples[neighbourIndex];
                if (Math.Abs(neighbour.Crf - rung.Point.Crf) < 2 ||
                    Math.Abs(neighbour.RawQuality - rung.Point.RawQuality) <= MaxQualityGap) {
                    continue;
                }

                Add(height, (neighbour.Crf + rung.Point.Crf) / 2, 4, "quality gap next to the selected rung");
            }
        }

        foreach (var window in plan.EmptyWindows) {
            if (double.IsInfinity(window.HighBps)) {
                continue;
            }

            Add(
                window.Height,
                CrfForRate(SamplesAt(window.Height), Math.Sqrt(window.LowBps * window.HighBps)),
                2,
                "no sample inside the window where this resolution wins");
        }

        foreach (var crossover in plan.Envelope.Crossovers) {
            Add(
                crossover.UpperHeight,
                CrfForRate(SamplesAt(crossover.UpperHeight), crossover.BitrateBps),
                3,
                $"at the {crossover.Key} crossover");

            if (crossover.Extrapolated) {
                Add(
                    crossover.LowerHeight,
                    CrfForRate(SamplesAt(crossover.LowerHeight), crossover.BitrateBps),
                    3,
                    $"extends the lower curve to the {crossover.Key} crossover");
            }
        }

        return targets
            .OrderBy(target => target.Priority)
            .ThenByDescending(target => target.Height)
            .ThenBy(target => target.Crf)
            .DistinctBy(target => (target.Height, target.Crf))
            .ToList();
    }

    /// <summary>
    /// The CRF expected to land on a given bitrate, from log₂(rate) interpolated linearly in CRF —
    /// the relationship x264's rate control is built around (roughly halving per +6 CRF).
    /// Extrapolates from the nearest pair outside the sampled range.
    /// </summary>
    internal static int? CrfForRate(IReadOnlyList<EncodeGridPoint> samples, double targetBps) {
        var ordered = samples
            .Where(point => point.BitrateBps > 0)
            .OrderBy(point => point.Crf)
            .ToList();

        if (ordered.Count < 2 || targetBps <= 0) {
            return null;
        }

        var target = Math.Log2(targetBps);

        (EncodeGridPoint A, EncodeGridPoint B) pair = (ordered[0], ordered[1]);
        if (target <= Math.Log2(ordered[^1].BitrateBps)) {
            pair = (ordered[^2], ordered[^1]);
        }

        for (var i = 0; i + 1 < ordered.Count; i++) {
            var high = Math.Log2(ordered[i].BitrateBps);
            var low = Math.Log2(ordered[i + 1].BitrateBps);
            if (target <= high && target >= low) {
                pair = (ordered[i], ordered[i + 1]);
                break;
            }
        }

        var rateA = Math.Log2(pair.A.BitrateBps);
        var rateB = Math.Log2(pair.B.BitrateBps);
        if (Math.Abs(rateA - rateB) < 1e-12) {
            return pair.A.Crf;
        }

        var crf = pair.A.Crf + (target - rateA) * (pair.B.Crf - pair.A.Crf) / (rateB - rateA);
        return (int)Math.Round(crf);
    }

    /// <summary>
    /// Expected harmonic VMAF at a CRF, interpolated between bracketing samples. Past either end it
    /// takes the nearest sample's value rather than extrapolating a curve that saturates.
    /// </summary>
    internal static double? PredictQuality(IReadOnlyList<EncodeGridPoint> samplesByCrf, int crf) {
        if (samplesByCrf.Count == 0) {
            return null;
        }

        if (crf <= samplesByCrf[0].Crf) {
            return samplesByCrf[0].RawQuality;
        }

        if (crf >= samplesByCrf[^1].Crf) {
            return samplesByCrf[^1].RawQuality;
        }

        for (var i = 0; i + 1 < samplesByCrf.Count; i++) {
            var a = samplesByCrf[i];
            var b = samplesByCrf[i + 1];
            if (crf < a.Crf || crf > b.Crf) {
                continue;
            }

            var t = b.Crf == a.Crf ? 0 : (double)(crf - a.Crf) / (b.Crf - a.Crf);
            return a.RawQuality + t * (b.RawQuality - a.RawQuality);
        }

        return samplesByCrf[^1].RawQuality;
    }

    private static Task ReportAsync(
        Func<int, int, CancellationToken, Task>? onProgress,
        int done,
        int total,
        CancellationToken cancellationToken) =>
        onProgress?.Invoke(done, Math.Max(done, total), cancellationToken) ?? Task.CompletedTask;

    private async Task<EncodeGridPoint> SampleAsync(
        string sourcePath,
        string tempRoot,
        TranscodeVariant variant,
        int crf,
        (int Width, int Height) reference,
        EncodeRecipe recipe,
        double cambiPenaltyWeight,
        CancellationToken cancellationToken) {
        var size = ParseResolution(variant.Resolution) ?? (0, 0);
        var stopwatch = Stopwatch.StartNew();

        var point = new EncodeGridPoint {
            Label = variant.Label,
            Width = size.Width,
            Height = size.Height,
            Crf = crf,
            CambiPenaltyWeight = cambiPenaltyWeight
        };

        try {
            var outPath = Path.Combine(tempRoot, $"{variant.Label}_crf{crf}.mp4");
            var encode = await _transcoder.EncodeCrfAsync(
                sourcePath,
                outPath,
                variant.Resolution,
                crf,
                recipe,
                cancellationToken: cancellationToken);

            if (!encode.Success || !File.Exists(outPath)) {
                point.Error = encode.ErrorMessage ?? "CRF encode failed";
                return point;
            }

            var bitrateBps = await MeasureVideoBitrateBpsAsync(_probe, outPath, cancellationToken);
            if (bitrateBps <= 0) {
                point.Error = "Could not measure encoded bitrate";
                return point;
            }

            point.BitrateBps = bitrateBps;

            var vmaf = await _vmaf.AnalyzeAsync(
                new VmafRequest {
                    ReferencePath = sourcePath,
                    DistortedPath = outPath,
                    ReferenceWidth = reference.Width,
                    ReferenceHeight = reference.Height,
                    DistortedWidth = size.Width,
                    DistortedHeight = size.Height,
                    BitrateBps = bitrateBps
                },
                cancellationToken);

            if (!vmaf.Success || vmaf.Series == null) {
                point.Error = vmaf.ErrorMessage ?? "VMAF failed";
                return point;
            }

            point.VmafMean = vmaf.Series.Summary.Mean;
            point.VmafHarmonicMean = vmaf.Series.Summary.HarmonicMean;
            point.VmafMin = vmaf.Series.Summary.Min;
            point.Cambi = vmaf.Series.Summary.Cambi;

            if (vmaf.Series.SummaryByModel?.TryGetValue(VmafAnalyzer.NegModelName, out var neg) == true) {
                point.VmafNegMean = neg.Mean;
                point.VmafNegHarmonicMean = neg.HarmonicMean;
            }

            _logger.LogInformation(
                "Encode grid{Suffix} {Label} CRF{Crf}: bitrate={Bitrate} vmaf={Vmaf:0.##} hvmaf={Harmonic:0.##} cambi={Cambi:0.##}",
                recipe.Tune == null ? "" : $" [{recipe.Tune}]",
                point.Label,
                point.Crf,
                point.BitrateBps,
                point.VmafMean,
                point.VmafHarmonicMean,
                point.Cambi);

            return point;
        } finally {
            point.ElapsedMs = stopwatch.ElapsedMilliseconds;
        }
    }

    private async Task<(int Width, int Height)?> ResolveReferenceResolutionAsync(
        string sourcePath,
        CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return null;
        }

        using (probe.ProbeData) {
            return TryGetVideoResolution(probe.ProbeData, out var width, out var height)
                ? (width, height)
                : null;
        }
    }

    private static AnalysisTreeNode BuildSection(
        List<EncodeGridPoint> points,
        EncodeRecipe recipe,
        string sectionId) {
        var succeeded = points.Count(point => string.IsNullOrEmpty(point.Error));

        var children = points
            .OrderByDescending(point => point.Height)
            .ThenBy(point => point.Crf)
            .Select(point => Leaf(
                $"{sectionId}.{point.Label}.crf{point.Crf}",
                $"{point.Label} CRF{point.Crf}",
                string.IsNullOrEmpty(point.Error)
                    ? $"VMAF {point.VmafMean:0.##} (harm. {point.VmafHarmonicMean:0.##})" +
                      (point.Cambi is { } cambi ? $", CAMBI {cambi:0.##}" : "") +
                      $" @ {FormatBitrate(point.BitrateBps)}"
                    : point.Error))
            .ToList();

        var label = recipe.Tune == null
            ? "Encode grid (res × CRF)"
            : $"Encode grid — {recipe.Tune}{(recipe.Decimate ? " + mpdecimate" : "")}";

        return Section(
            sectionId,
            label,
            "encode-grid",
            succeeded > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
            succeeded > 0 ? null : "No successful grid points",
            children);
    }
}
