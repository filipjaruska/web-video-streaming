using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class EncodeGridResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public List<EncodeGridPoint> Points { get; init; } = [];
    public bool Windowed { get; init; }
}

/// <summary>
/// Sweeps resolution × CRF, measuring real bitrate and full-reference VMAF for each sample.
/// The resulting RD points are what <see cref="LadderDerivation"/> builds a ladder from.
/// </summary>
public sealed class EncodeGrid {
    /// <summary>
    /// First pass: a wide, evenly spaced sweep that brackets every resolution's usable range.
    /// Deliberately coarse — the refinement pass is what buys resolution where it matters.
    /// </summary>
    private static readonly int[] CoarseCrfs = [20, 24, 28, 32, 36, 40];

    /// <summary>
    /// The quality band ladder rungs are actually chosen from. A coarse grid leaves the hull
    /// under-sampled exactly here, which is what makes crossover estimates unstable.
    /// </summary>
    private const double RefineBandLow = 85;
    private const double RefineBandHigh = 95;

    /// <summary>Quality gap between adjacent samples wide enough to justify another encode.</summary>
    private const double MaxQualityGap = 2.5;

    private const int MaxSamplesPerResolution = 9;

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
        RepresentativeClipResult clip,
        Func<int, int, CancellationToken, Task>? onProgress = null,
        CancellationToken cancellationToken = default) {
        var points = new List<EncodeGridPoint>();
        var tempRoot = NewTempDir("encode-grid");

        try {
            var reference = await ResolveReferenceResolutionAsync(clip.Path, cancellationToken);
            if (reference == null) {
                return new EncodeGridResult {
                    Success = false,
                    ErrorMessage = "Could not read source resolution for encode grid"
                };
            }

            var variants = TranscodeProfile.Default.Variants;
            var done = 0;

            // Upper bound while the coarse pass runs; it settles to the real count once refinement
            // decides how many extra samples each resolution earns.
            var total = variants.Count * MaxSamplesPerResolution;

            if (onProgress != null) {
                await onProgress(done, total, cancellationToken);
            }

            for (var index = 0; index < variants.Count; index++) {
                var variant = variants[index];
                var size = ParseResolution(variant.Resolution) ?? (0, 0);
                var forVariant = new List<EncodeGridPoint>();

                foreach (var crf in CoarseCrfs) {
                    cancellationToken.ThrowIfCancellationRequested();
                    forVariant.Add(await SampleAsync(clip, tempRoot, variant, size, crf, reference.Value, cancellationToken));
                    await ReportAsync(onProgress, ++done, total, cancellationToken);
                }

                // Refinement: bisect wherever the curve is still too coarse to read a rung off.
                while (forVariant.Count < MaxSamplesPerResolution) {
                    var crf = NextRefinementCrf(forVariant);
                    if (crf == null) {
                        break;
                    }

                    cancellationToken.ThrowIfCancellationRequested();
                    forVariant.Add(await SampleAsync(clip, tempRoot, variant, size, crf.Value, reference.Value, cancellationToken));
                    await ReportAsync(onProgress, ++done, total, cancellationToken);
                }

                points.AddRange(forVariant.OrderBy(point => point.Crf));

                // Now that this resolution is settled, the estimate for what remains is exact for
                // the work already done and still an upper bound for the resolutions ahead.
                total = done + (variants.Count - index - 1) * MaxSamplesPerResolution;
            }

            var succeeded = points.Any(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0);

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { EncodeGrid = points },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(points, clip),
                cancellationToken);

            return new EncodeGridResult {
                Success = succeeded,
                ErrorMessage = succeeded ? null : "No successful encode-grid points",
                Points = points,
                Windowed = clip.Windowed
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Encode grid failed for {RouteId}", routeId);
            return new EncodeGridResult {
                Success = false,
                ErrorMessage = ex.Message,
                Points = points,
                Windowed = clip.Windowed
            };
        } finally {
            TryDeleteDirectory(tempRoot, _logger);
        }
    }

    /// <summary>
    /// The CRF worth sampling next for one resolution: the midpoint of whichever adjacent pair
    /// leaves the largest unresolved quality gap, preferring pairs that span the band rungs are
    /// selected from. Returns null once the curve is dense enough.
    /// </summary>
    internal static int? NextRefinementCrf(IReadOnlyList<EncodeGridPoint> points) {
        var usable = points
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0)
            .OrderBy(point => point.Crf)
            .ToList();

        var sampled = points.Select(point => point.Crf).ToHashSet();
        int? best = null;
        var bestPriority = double.NegativeInfinity;

        for (var i = 0; i < usable.Count - 1; i++) {
            var low = usable[i];
            var high = usable[i + 1];
            if (high.Crf - low.Crf < 2) {
                continue;
            }

            var midpoint = (low.Crf + high.Crf) / 2;
            if (!sampled.Add(midpoint)) {
                continue;
            }

            // Quality falls as CRF rises, so the higher-CRF sample is the lower-quality end.
            var gap = Math.Abs(low.DecisionQuality - high.DecisionQuality);
            var spansBand =
                Math.Min(low.DecisionQuality, high.DecisionQuality) <= RefineBandHigh &&
                Math.Max(low.DecisionQuality, high.DecisionQuality) >= RefineBandLow;

            if (!spansBand && gap <= MaxQualityGap) {
                continue;
            }

            var priority = spansBand ? gap + 100 : gap;
            if (priority > bestPriority) {
                bestPriority = priority;
                best = midpoint;
            }
        }

        return best;
    }

    private static Task ReportAsync(
        Func<int, int, CancellationToken, Task>? onProgress,
        int done,
        int total,
        CancellationToken cancellationToken) =>
        onProgress?.Invoke(done, Math.Max(done, total), cancellationToken) ?? Task.CompletedTask;

    private async Task<EncodeGridPoint> SampleAsync(
        RepresentativeClipResult clip,
        string tempRoot,
        TranscodeVariant variant,
        (int Width, int Height) size,
        int crf,
        (int Width, int Height) reference,
        CancellationToken cancellationToken) {
        var point = new EncodeGridPoint {
            Label = variant.Label,
            Width = size.Width,
            Height = size.Height,
            Crf = crf
        };

        var outPath = Path.Combine(tempRoot, $"{variant.Label}_crf{crf}.mp4");
        var encode = await _transcoder.EncodeCrfAsync(
            clip.Path,
            outPath,
            variant.Resolution,
            crf,
            cancellationToken: cancellationToken);

        if (!encode.Success || !File.Exists(outPath)) {
            point.Error = encode.ErrorMessage ?? "CRF encode failed";
            return point;
        }

        var bitrateBps = await MeasureBitrateBpsAsync(_probe, outPath, cancellationToken);
        if (bitrateBps <= 0) {
            point.Error = "Could not measure encoded bitrate";
            return point;
        }

        point.BitrateBps = bitrateBps;

        var vmaf = await _vmaf.AnalyzeAsync(
            new VmafRequest {
                ReferencePath = clip.Path,
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

        if (vmaf.Series.SummaryByModel?.TryGetValue(VmafAnalyzer.NegModelName, out var neg) == true) {
            point.VmafNegMean = neg.Mean;
            point.VmafNegHarmonicMean = neg.HarmonicMean;
        }

        _logger.LogInformation(
            "Encode grid {Label} CRF{Crf}: bitrate={Bitrate} vmaf={Vmaf:0.##} hvmaf={Harmonic:0.##}",
            point.Label,
            point.Crf,
            point.BitrateBps,
            point.VmafMean,
            point.VmafHarmonicMean);

        return point;
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

    private static AnalysisTreeNode BuildSection(List<EncodeGridPoint> points, RepresentativeClipResult clip) {
        var succeeded = points.Count(point => string.IsNullOrEmpty(point.Error));

        var children = points
            .OrderByDescending(point => point.Height)
            .ThenBy(point => point.Crf)
            .Select(point => Leaf(
                $"encodeGrid.{point.Label}.crf{point.Crf}",
                $"{point.Label} CRF{point.Crf}",
                string.IsNullOrEmpty(point.Error)
                    ? $"VMAF {point.VmafMean:0.##} (harm. {point.VmafHarmonicMean:0.##}) @ {FormatBitrate(point.BitrateBps)}"
                    : point.Error))
            .ToList();

        children.Insert(0, Leaf(
            "encodeGrid.scope",
            "Scored on",
            clip.Windowed
                ? $"{clip.Windows.Count} SI/TI windows ({clip.DurationSec:0.#} s)"
                : "whole clip"));

        return Section(
            "encodeGrid",
            "Encode grid (res × CRF)",
            "encode-grid",
            succeeded > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
            succeeded > 0 ? null : "No successful grid points",
            children);
    }
}
