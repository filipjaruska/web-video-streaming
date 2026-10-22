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

    /// <summary>
    /// Six coarse CRFs on each of the six resolutions, plus fifteen refinement samples — the fifteen
    /// the grid had when the ladder had five resolutions and a budget of 45.
    /// </summary>
    internal const int MaxSamplesTotal = 51;
    internal const int LowestCrf = 12;
    internal const int HighestCrf = 51;

    /// <summary>Quality gap next to a selected rung wide enough to justify another encode.</summary>
    private const double MaxQualityGap = 2.5;


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
        IReadOnlyList<EncodeGridPoint>? defaultGrid = null,
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
                // A pooled ladder is refined against both settings' samples, the way it is derived.
                var candidates = defaultGrid != null
                    ? LadderDerivation.Pool(points, defaultGrid, cambiPenaltyWeight)
                    : points;

                var plan = LadderDerivation.Plan(candidates);
                if (plan.Error != null) {
                    break;
                }

                var next = NextTargets(candidates, plan, variants)
                    .FirstOrDefault(target => points.Count(point => point.Height == target.Height) < MaxSamplesPerResolution);

                if (next == null) {
                    break;
                }

                // A sample the pooled ladder wants under the default setting is encoded under it and
                // kept in this grid tagged as such; everything else is this grid's own setting.
                var underDefault = defaultGrid != null && next.Setting == EncodeSettings.Default;
                var sampleRecipe = underDefault ? EncodeRecipe.Default : recipe;

                cancellationToken.ThrowIfCancellationRequested();
                _logger.LogInformation(
                    "Encode grid refinement{Suffix}: {Label} CRF{Crf}{Setting} — {Reason}",
                    recipe.Tune == null ? "" : $" [{recipe.Tune}]",
                    next.Variant.Label,
                    next.Crf,
                    underDefault ? " under the default setting" : "",
                    next.Reason);

                var point = await SampleAsync(
                    sourcePath, tempRoot, next.Variant, next.Crf, reference.Value, sampleRecipe, cambiPenaltyWeight, cancellationToken);
                point.Setting = underDefault ? EncodeSettings.Default : null;
                points.Add(point);
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
    /// <param name="Setting">
    /// The setting to encode it under — null for the grid's own. Set only when refining a pooled
    /// ladder, where a rung's sample belongs in the grid of the setting that rung takes.
    /// </param>
    internal sealed record GridTarget(TranscodeVariant Variant, int Height, int Crf, int Priority, string Reason, string? Setting = null);

    /// <summary>
    /// Where the next samples are worth spending, given the current provisional ladder.
    /// </summary>
    /// <remarks>
    /// Priority 1 — a rung at the grid's lowest CRF with the hull still steeper than λ: extend below.
    /// Priority 2 — a rung clamped to a bound of its admissible interval: sample at the rung's own
    /// rate, so its predicted quality rests on a nearby sample. Also a resolution whose interval
    /// lies past its highest sample: sample inside that interval.
    /// Priority 3 — each crossover: sample the resolution taking over, and extend the lower one
    /// when the crossover lies past its last sample.
    /// Priority 4 — a quality gap next to a selected rung.
    /// Targets predicted to fall below the quality floor, outside the CRF range, or already
    /// sampled are skipped.
    /// <para>
    /// On a pooled ladder every target names the setting to encode it under: a rung's in the
    /// setting that rung takes, a crossover's in the setting that does better there. CRF and rate
    /// are related differently under each setting, so each is aimed off that setting's samples.
    /// </para>
    /// </remarks>
    internal static List<GridTarget> NextTargets(
        IReadOnlyList<EncodeGridPoint> points,
        LadderDerivation.LadderPlan plan,
        IReadOnlyList<TranscodeVariant> variants) {
        var ok = points.Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0).ToList();
        var sampled = points.Select(point => (point.Height, point.Crf, point.Setting)).ToHashSet();
        var variantByHeight = variants
            .Select(variant => (Variant: variant, Height: ParseResolution(variant.Resolution)?.Height ?? 0))
            .Where(item => item.Height > 0)
            .GroupBy(item => item.Height)
            .ToDictionary(group => group.Key, group => group.First().Variant);

        var targets = new List<GridTarget>();

        List<EncodeGridPoint> SamplesAt(int height, string? setting) =>
            ok.Where(point => point.Height == height && point.Setting == setting).OrderBy(point => point.Crf).ToList();

        // The setting that does better at a rate on a resolution's curves — null on a single-setting grid.
        string? SettingAt(int height, double bitrateBps) =>
            plan.Hulls.FirstOrDefault(hull => hull.Height == height) is { } hull
                ? LadderDerivation.PredictAt(hull, bitrateBps).Setting
                : null;

        void Add(int height, string? setting, int? crf, int priority, string reason) {
            if (crf == null || !variantByHeight.TryGetValue(height, out var variant)) {
                return;
            }

            var value = Math.Clamp(crf.Value, LowestCrf, HighestCrf);
            if (sampled.Contains((height, value, setting))) {
                return;
            }

            if (PredictQuality(SamplesAt(height, setting), value) is { } predicted && predicted < LadderDerivation.QualityFloor) {
                return;
            }

            targets.Add(new GridTarget(variant, height, value, priority, reason, setting));
        }

        foreach (var rung in plan.Rungs) {
            var height = rung.Hull.Height;

            if (rung.AtGridBoundary) {
                var setting = rung.LambdaPoint.Setting;
                var samples = SamplesAt(height, setting);
                if (samples.Count > 0) {
                    var minCrf = samples.Min(point => point.Crf);
                    var extended = sampled.Contains((height, minCrf - 4, setting)) ? minCrf - 2 : minCrf - 4;
                    Add(height, setting, extended, 1, "tangent point lies past the grid's lowest CRF");
                }
            }

            // A clamped rung's quality is read off its setting's curve between two samples; one at
            // its own rate, in that setting, makes that reading a measurement.
            var rungSetting = rung.Prediction.Setting;
            var rungSamples = SamplesAt(height, rungSetting);
            if (rung.Placement != LadderDerivation.Placements.Lambda && !rung.Prediction.OnVertex) {
                Add(
                    height,
                    rungSetting,
                    CrfForRate(rungSamples, rung.BitrateBps),
                    2,
                    $"at the {rung.Placement} bound this rung is clamped to");
            }

            var anchor = rung.Anchor;
            var index = rungSamples.FindIndex(point => ReferenceEquals(point, anchor));
            if (index < 0) {
                continue;
            }

            foreach (var neighbourIndex in new[] { index - 1, index + 1 }) {
                if (neighbourIndex < 0 || neighbourIndex >= rungSamples.Count) {
                    continue;
                }

                var neighbour = rungSamples[neighbourIndex];
                if (Math.Abs(neighbour.Crf - anchor.Crf) < 2 ||
                    Math.Abs(neighbour.RawQuality - anchor.RawQuality) <= MaxQualityGap) {
                    continue;
                }

                Add(height, rungSetting, (neighbour.Crf + anchor.Crf) / 2, 4, "quality gap next to the selected rung");
            }
        }

        foreach (var window in plan.EmptyWindows) {
            if (double.IsInfinity(window.HighBps)) {
                continue;
            }

            var rate = Math.Sqrt(window.LowBps * window.HighBps);
            var setting = SettingAt(window.Height, rate);
            Add(
                window.Height,
                setting,
                CrfForRate(SamplesAt(window.Height, setting), rate),
                2,
                "no sample inside the window where this resolution wins");
        }

        foreach (var crossover in plan.Envelope.Crossovers) {
            var upper = SettingAt(crossover.UpperHeight, crossover.BitrateBps);
            Add(
                crossover.UpperHeight,
                upper,
                CrfForRate(SamplesAt(crossover.UpperHeight, upper), crossover.BitrateBps),
                3,
                $"at the {crossover.Key} crossover");

            if (crossover.Extrapolated) {
                var lower = SettingAt(crossover.LowerHeight, crossover.BitrateBps);
                Add(
                    crossover.LowerHeight,
                    lower,
                    CrfForRate(SamplesAt(crossover.LowerHeight, lower), crossover.BitrateBps),
                    3,
                    $"extends the lower curve to the {crossover.Key} crossover");
            }
        }

        return targets
            .OrderBy(target => target.Priority)
            .ThenByDescending(target => target.Height)
            .ThenBy(target => target.Crf)
            .DistinctBy(target => (target.Height, target.Crf, target.Setting))
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
