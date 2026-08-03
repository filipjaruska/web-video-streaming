using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using WebWVideoStreamingAPI.Infrastructure.Analysis;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed class LadderDerivationResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public TranscodeProfile? Profile { get; init; }
    public DerivedLadderDocument? Document { get; init; }
}

public interface ILadderDerivationService {
    Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        CancellationToken cancellationToken = default);

    string SerializeProfile(TranscodeProfile profile);
}

/// <summary>
/// Convex-hull / crossover ladder derivation from encode-grid RD points (thesis 4.3.2).
/// </summary>
public sealed class LadderDerivationService : ILadderDerivationService {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly IVideoTranscodeAnalysisService _analysis;
    private readonly ILogger<LadderDerivationService> _logger;

    public LadderDerivationService(
        IVideoTranscodeAnalysisService analysis,
        ILogger<LadderDerivationService> logger) {
        _analysis = analysis;
        _logger = logger;
    }

    public async Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        CancellationToken cancellationToken = default) {
        var usable = points
            .Where(p => string.IsNullOrEmpty(p.Error) && p.BitrateBps > 0 && p.VmafMean > 0)
            .ToList();

        if (usable.Count < 2) {
            return new LadderDerivationResult {
                Success = false,
                ErrorMessage = "Need at least two successful encode-grid points to derive a ladder"
            };
        }

        try {
            var hull = BuildParetoFront(usable);
            var byHeight = hull
                .GroupBy(p => p.Height)
                .OrderByDescending(g => g.Key)
                .ToList();

            if (byHeight.Count == 0) {
                return new LadderDerivationResult {
                    Success = false,
                    ErrorMessage = "Pareto front was empty"
                };
            }

            // One operating point per height: prefer hull point nearest VMAF 93 (typical streaming target).
            const double targetVmaf = 93.0;
            var selected = new List<EncodeGridPoint>();
            foreach (var group in byHeight) {
                var pick = group
                    .OrderBy(p => Math.Abs(p.VmafMean - targetVmaf))
                    .ThenBy(p => p.BitrateBps)
                    .First();
                selected.Add(pick);
            }

            // Enforce monotonic bitrate with height (higher res → higher or equal bitrate).
            selected = selected.OrderBy(p => p.Height).ToList();
            for (var i = 1; i < selected.Count; i++) {
                if (selected[i].BitrateBps < selected[i - 1].BitrateBps) {
                    selected[i].BitrateBps = selected[i - 1].BitrateBps + 50_000;
                }
            }

            // Apply crossover bitrates between adjacent heights: operating bitrate for higher res
            // should sit at/above the interpolated intersection with the next-lower curve.
            selected = selected.OrderByDescending(p => p.Height).ToList();
            for (var i = 0; i < selected.Count - 1; i++) {
                var hi = selected[i];
                var lo = selected[i + 1];
                var crossover = FindCrossoverBitrate(usable, hi.Height, lo.Height);
                if (crossover != null && hi.BitrateBps < crossover.Value) {
                    hi.BitrateBps = crossover.Value;
                }
            }

            // Re-enforce descending height → descending bitrate after crossover bumps.
            selected = selected.OrderByDescending(p => p.Height).ToList();
            for (var i = 1; i < selected.Count; i++) {
                if (selected[i].BitrateBps > selected[i - 1].BitrateBps) {
                    selected[i].BitrateBps = Math.Max(100_000, selected[i - 1].BitrateBps - 50_000);
                }
            }

            var variants = new List<TranscodeVariant>();
            var derivedVariants = new List<DerivedLadderVariant>();
            foreach (var point in selected.OrderByDescending(p => p.Height)) {
                var kbps = Math.Max(100, (int)Math.Round(point.BitrateBps / 1000.0 / 50.0) * 50);
                var bitrate = $"{kbps}k";
                var resolution = $"{point.Width}:{point.Height}";
                variants.Add(new TranscodeVariant(resolution, bitrate, point.Label));
                derivedVariants.Add(new DerivedLadderVariant {
                    Label = point.Label,
                    Resolution = resolution,
                    Bitrate = bitrate,
                    BitrateBps = kbps * 1000L,
                    PredictedVmaf = point.VmafMean
                });
            }

            // Ensure we cover Default labels when a height never appeared on the hull.
            foreach (var fallback in TranscodeProfile.Default.Variants) {
                if (variants.Any(v => string.Equals(v.Label, fallback.Label, StringComparison.OrdinalIgnoreCase))) {
                    continue;
                }

                variants.Add(fallback);
                derivedVariants.Add(new DerivedLadderVariant {
                    Label = fallback.Label,
                    Resolution = fallback.Resolution,
                    Bitrate = fallback.Bitrate,
                    BitrateBps = TranscodeProfile.ParseBitrateKbps(fallback.Bitrate) * 1000L
                });
            }

            variants = variants
                .OrderByDescending(v => {
                    var parts = v.Resolution.Split(':');
                    return parts.Length == 2 && int.TryParse(parts[1], out var h) ? h : 0;
                })
                .ToList();
            derivedVariants = derivedVariants
                .OrderByDescending(v => {
                    var parts = v.Resolution.Split(':');
                    return parts.Length == 2 && int.TryParse(parts[1], out var h) ? h : 0;
                })
                .ToList();

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

            await _analysis.SetSeriesAsync(
                staticTranscodeId,
                new AnalysisSeriesDocument { DerivedLadder = document },
                cancellationToken);

            await _analysis.UpsertSectionAsync(
                staticTranscodeId,
                new AnalysisTreeNode {
                    Id = "derivedLadder",
                    Label = "Derived ladder (VMAF crossover)",
                    Meta = new AnalysisTreeNodeMeta {
                        Source = "ladder-derivation",
                        Status = AnalysisSectionStatus.Completed,
                        Kind = "section"
                    },
                    Children = derivedVariants.Select(v => new AnalysisTreeNode {
                        Id = $"derivedLadder.{v.Label}",
                        Label = v.Label,
                        Value = $"{v.Bitrate}" +
                                (v.PredictedVmaf != null
                                    ? $" (pred. VMAF {v.PredictedVmaf.Value.ToString("0.##", CultureInfo.InvariantCulture)})"
                                    : "")
                    }).ToList()
                },
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
            return new LadderDerivationResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        }
    }

    public string SerializeProfile(TranscodeProfile profile) {
        var dto = new {
            name = profile.Name,
            videoCodec = profile.VideoCodec,
            audioCodec = profile.AudioCodec,
            audioBitrate = profile.AudioBitrate,
            segmentDurationSeconds = profile.SegmentDurationSeconds,
            variants = profile.Variants.Select(v => new {
                label = v.Label,
                resolution = v.Resolution,
                bitrate = v.Bitrate
            }).ToList()
        };
        return JsonSerializer.Serialize(dto, JsonOptions);
    }

    /// <summary>
    /// Pareto front maximizing VMAF for a given bitrate (and minimizing bitrate for a given VMAF).
    /// </summary>
    internal static List<EncodeGridPoint> BuildParetoFront(IReadOnlyList<EncodeGridPoint> points) {
        var ordered = points.OrderBy(p => p.BitrateBps).ThenByDescending(p => p.VmafMean).ToList();
        var hull = new List<EncodeGridPoint>();
        double bestVmaf = double.NegativeInfinity;

        foreach (var point in ordered) {
            if (point.VmafMean > bestVmaf + 1e-6) {
                hull.Add(point);
                bestVmaf = point.VmafMean;
            }
        }

        return hull;
    }

    /// <summary>
    /// Approximate crossover bitrate between two resolution curves via sampled linear interpolation.
    /// </summary>
    internal static long? FindCrossoverBitrate(
        IReadOnlyList<EncodeGridPoint> all,
        int highHeight,
        int lowHeight) {
        var hiCurve = all
            .Where(p => p.Height == highHeight && string.IsNullOrEmpty(p.Error))
            .OrderBy(p => p.BitrateBps)
            .ToList();
        var loCurve = all
            .Where(p => p.Height == lowHeight && string.IsNullOrEmpty(p.Error))
            .OrderBy(p => p.BitrateBps)
            .ToList();

        if (hiCurve.Count < 2 || loCurve.Count < 2) {
            return null;
        }

        var minB = Math.Max(hiCurve.First().BitrateBps, loCurve.First().BitrateBps);
        var maxB = Math.Min(hiCurve.Last().BitrateBps, loCurve.Last().BitrateBps);
        if (maxB <= minB) {
            return null;
        }

        long? lastWhereHiBetter = null;
        const int samples = 40;
        for (var i = 0; i <= samples; i++) {
            var b = minB + (maxB - minB) * i / samples;
            var hiV = InterpolateVmaf(hiCurve, b);
            var loV = InterpolateVmaf(loCurve, b);
            if (hiV == null || loV == null) {
                continue;
            }

            if (hiV >= loV) {
                lastWhereHiBetter = b;
            } else if (lastWhereHiBetter != null) {
                // Crossed: higher res no longer better — crossover near previous sample.
                return lastWhereHiBetter;
            }
        }

        return lastWhereHiBetter;
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
            var a = curve[i];
            var b = curve[i + 1];
            if (bitrateBps < a.BitrateBps || bitrateBps > b.BitrateBps) {
                continue;
            }

            var t = (bitrateBps - a.BitrateBps) / (double)(b.BitrateBps - a.BitrateBps);
            return a.VmafMean + t * (b.VmafMean - a.VmafMean);
        }

        return null;
    }
}
