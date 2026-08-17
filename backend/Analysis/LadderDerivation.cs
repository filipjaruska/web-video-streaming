using System.Globalization;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

namespace WebWVideoStreamingAPI.Analysis;

public sealed class LadderDerivationResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public TranscodeProfile? Profile { get; init; }
    public DerivedLadderDocument? Document { get; init; }
}

/// <summary>
/// Convex-hull / crossover ladder derivation from encode-grid RD points (thesis 4.3.2).
/// </summary>
public sealed class LadderDerivation {
    /// <summary>Typical streaming quality target; hull points nearest this win their resolution.</summary>
    private const double TargetVmaf = 93.0;

    private readonly AnalysisStore _store;
    private readonly ILogger<LadderDerivation> _logger;

    public LadderDerivation(AnalysisStore store, ILogger<LadderDerivation> logger) {
        _store = store;
        _logger = logger;
    }

    public async Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        CancellationToken cancellationToken = default) {
        var usable = points
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0 && point.VmafMean > 0)
            .ToList();

        if (usable.Count < 2) {
            return Fail("Need at least two successful encode-grid points to derive a ladder");
        }

        try {
            var selected = SelectOperatingPoints(usable);
            if (selected.Count == 0) {
                return Fail("Pareto front was empty");
            }

            var (variants, derivedVariants) = BuildVariants(selected);

            var profile = new TranscodeProfile {
                Name = "vmaf-crossover",
                Variants = variants,
                VideoCodec = TranscodeProfile.Default.VideoCodec,
                AudioCodec = TranscodeProfile.Default.AudioCodec,
                AudioBitrate = TranscodeProfile.Default.AudioBitrate,
                SegmentDurationSeconds = TranscodeProfile.Default.SegmentDurationSeconds
            };

            var document = new DerivedLadderDocument {
                Name = profile.Name,
                Variants = derivedVariants
            };

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { DerivedLadder = document },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(derivedVariants),
                cancellationToken);

            _logger.LogInformation(
                "Derived dynamic ladder with {Count} rungs for static transcode {TranscodeId}",
                variants.Count,
                staticTranscodeId);

            return new LadderDerivationResult {
                Success = true,
                Profile = profile,
                Document = document
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Ladder derivation failed for {TranscodeId}", staticTranscodeId);
            return Fail(ex.Message);
        }
    }

    /// <summary>
    /// One operating point per resolution, taken off the Pareto front, then adjusted so bitrate
    /// falls monotonically with resolution and each rung sits at or above its crossover with the
    /// next one down.
    /// </summary>
    private static List<EncodeGridPoint> SelectOperatingPoints(List<EncodeGridPoint> usable) {
        var byHeight = BuildParetoFront(usable)
            .GroupBy(point => point.Height)
            .OrderByDescending(group => group.Key)
            .ToList();

        if (byHeight.Count == 0) {
            return [];
        }

        var selected = byHeight
            .Select(group => group
                .OrderBy(point => Math.Abs(point.VmafMean - TargetVmaf))
                .ThenBy(point => point.BitrateBps)
                .First())
            .OrderBy(point => point.Height)
            .ToList();

        // Higher resolution must not cost less than a lower one.
        for (var i = 1; i < selected.Count; i++) {
            if (selected[i].BitrateBps < selected[i - 1].BitrateBps) {
                selected[i].BitrateBps = selected[i - 1].BitrateBps + 50_000;
            }
        }

        // Lift each rung to its crossover with the next-lower curve, where the higher resolution
        // stops winning on quality.
        selected = selected.OrderByDescending(point => point.Height).ToList();
        for (var i = 0; i < selected.Count - 1; i++) {
            var crossover = FindCrossoverBitrate(usable, selected[i].Height, selected[i + 1].Height);
            if (crossover != null && selected[i].BitrateBps < crossover.Value) {
                selected[i].BitrateBps = crossover.Value;
            }
        }

        // Re-enforce descending bitrate after the crossover bumps.
        for (var i = 1; i < selected.Count; i++) {
            if (selected[i].BitrateBps > selected[i - 1].BitrateBps) {
                selected[i].BitrateBps = Math.Max(100_000, selected[i - 1].BitrateBps - 50_000);
            }
        }

        return selected;
    }

    private static (List<TranscodeVariant> Variants, List<DerivedLadderVariant> Derived) BuildVariants(
        List<EncodeGridPoint> selected) {
        var variants = new List<TranscodeVariant>();
        var derived = new List<DerivedLadderVariant>();

        foreach (var point in selected.OrderByDescending(item => item.Height)) {
            var kbps = Math.Max(100, (int)Math.Round(point.BitrateBps / 1000.0 / 50.0) * 50);
            var bitrate = $"{kbps}k";
            var resolution = $"{point.Width}:{point.Height}";

            variants.Add(new TranscodeVariant(resolution, bitrate, point.Label));
            derived.Add(new DerivedLadderVariant {
                Label = point.Label,
                Resolution = resolution,
                Bitrate = bitrate,
                BitrateBps = kbps * 1000L,
                PredictedVmaf = point.VmafMean
            });
        }

        // Cover any default rung whose resolution never made it onto the hull.
        foreach (var fallback in TranscodeProfile.Default.Variants) {
            if (variants.Any(variant => string.Equals(variant.Label, fallback.Label, StringComparison.OrdinalIgnoreCase))) {
                continue;
            }

            variants.Add(fallback);
            derived.Add(new DerivedLadderVariant {
                Label = fallback.Label,
                Resolution = fallback.Resolution,
                Bitrate = fallback.Bitrate,
                BitrateBps = TranscodeProfile.ParseBitrateKbps(fallback.Bitrate) * 1000L
            });
        }

        return (
            variants.OrderByDescending(HeightOf).ToList(),
            derived.OrderByDescending(variant => MediaFormatting.ParseResolution(variant.Resolution)?.Height ?? 0).ToList()
        );

        static int HeightOf(TranscodeVariant variant) =>
            MediaFormatting.ParseResolution(variant.Resolution)?.Height ?? 0;
    }

    private static AnalysisTreeNode BuildSection(List<DerivedLadderVariant> derived) {
        return Section(
            "derivedLadder",
            "Derived ladder (VMAF crossover)",
            "ladder-derivation",
            AnalysisSectionStatus.Completed,
            children: derived
                .Select(variant => Leaf(
                    $"derivedLadder.{variant.Label}",
                    variant.Label,
                    variant.PredictedVmaf != null
                        ? $"{variant.Bitrate} (pred. VMAF {variant.PredictedVmaf.Value.ToString("0.##", CultureInfo.InvariantCulture)})"
                        : variant.Bitrate))
                .ToList());
    }

    /// <summary>Pareto front maximizing VMAF for a given bitrate (and minimizing bitrate for a given VMAF).</summary>
    private static List<EncodeGridPoint> BuildParetoFront(IReadOnlyList<EncodeGridPoint> points) {
        var hull = new List<EncodeGridPoint>();
        var bestVmaf = double.NegativeInfinity;

        foreach (var point in points.OrderBy(item => item.BitrateBps).ThenByDescending(item => item.VmafMean)) {
            if (point.VmafMean > bestVmaf + 1e-6) {
                hull.Add(point);
                bestVmaf = point.VmafMean;
            }
        }

        return hull;
    }

    /// <summary>Approximate crossover bitrate between two resolution curves via sampled interpolation.</summary>
    private static long? FindCrossoverBitrate(IReadOnlyList<EncodeGridPoint> all, int highHeight, int lowHeight) {
        var high = CurveFor(all, highHeight);
        var low = CurveFor(all, lowHeight);

        if (high.Count < 2 || low.Count < 2) {
            return null;
        }

        var min = Math.Max(high[0].BitrateBps, low[0].BitrateBps);
        var max = Math.Min(high[^1].BitrateBps, low[^1].BitrateBps);
        if (max <= min) {
            return null;
        }

        long? lastWhereHighWins = null;
        const int samples = 40;

        for (var i = 0; i <= samples; i++) {
            var bitrate = min + (max - min) * i / samples;
            var highVmaf = InterpolateVmaf(high, bitrate);
            var lowVmaf = InterpolateVmaf(low, bitrate);
            if (highVmaf == null || lowVmaf == null) {
                continue;
            }

            if (highVmaf >= lowVmaf) {
                lastWhereHighWins = bitrate;
            } else if (lastWhereHighWins != null) {
                // Crossed: the higher resolution stopped winning near the previous sample.
                return lastWhereHighWins;
            }
        }

        return lastWhereHighWins;

        static List<EncodeGridPoint> CurveFor(IReadOnlyList<EncodeGridPoint> all, int height) => all
            .Where(point => point.Height == height && string.IsNullOrEmpty(point.Error))
            .OrderBy(point => point.BitrateBps)
            .ToList();
    }

    private static double? InterpolateVmaf(IReadOnlyList<EncodeGridPoint> curve, long bitrateBps) {
        if (curve.Count == 0) {
            return null;
        }

        if (bitrateBps <= curve[0].BitrateBps) {
            return curve[0].VmafMean;
        }

        if (bitrateBps >= curve[^1].BitrateBps) {
            return curve[^1].VmafMean;
        }

        for (var i = 0; i < curve.Count - 1; i++) {
            var low = curve[i];
            var high = curve[i + 1];
            if (bitrateBps < low.BitrateBps || bitrateBps > high.BitrateBps) {
                continue;
            }

            var t = (bitrateBps - low.BitrateBps) / (double)(high.BitrateBps - low.BitrateBps);
            return low.VmafMean + t * (high.VmafMean - low.VmafMean);
        }

        return null;
    }

    private static LadderDerivationResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
