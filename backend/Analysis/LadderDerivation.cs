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
/// Derives a content-specific bitrate ladder from encode-grid RD points by building the convex
/// hull of quality against log-bitrate and taking one operating point per resolution at a shared
/// hull slope (thesis 4.3.1.2).
/// </summary>
public sealed class LadderDerivation {
    /// <summary>
    /// The trade-off the whole ladder is built at, in harmonic-mean VMAF per doubling of bitrate.
    /// </summary>
    /// <remarks>
    /// λ is the primary control, not a derived quantity, and in log-rate space it has a directly
    /// readable meaning: keep buying bits while doubling the bitrate still returns at least this
    /// much quality, and stop once it does not. That is what makes the ladder content-adaptive —
    /// a curve that saturates early stops early and lands cheap, while one that keeps climbing is
    /// followed further up. Driving selection off an absolute quality target instead inverts this:
    /// on hard content the target is only reachable far past the point of diminishing returns, and
    /// the ladder dutifully pays for it.
    /// </remarks>
    private const double LambdaBaseSlope = 4.0;

    /// <summary>
    /// Quality range the top rung is kept inside regardless of slope. The ceiling stops λ paying
    /// for quality no viewer can distinguish (thesis 3.3.3); the floor stops exceptionally hard
    /// content from shipping a top rung that is visibly poor when the hull could do better.
    /// </summary>
    private const double TopRungCeiling = 95.0;
    private const double TopRungFloor = 88.0;

    /// <summary>
    /// Adjacent rungs must differ by at least this factor in bitrate. Two rungs a few percent
    /// apart give an ABR algorithm nothing to choose between while costing a full extra encode.
    /// </summary>
    private const double MinRungSpacing = 1.5;

    private const long BitrateFloorBps = 100_000;
    private const int RoundToKbps = 50;

    private readonly AnalysisStore _store;
    private readonly ILogger<LadderDerivation> _logger;

    public LadderDerivation(AnalysisStore store, ILogger<LadderDerivation> logger) {
        _store = store;
        _logger = logger;
    }

    public async Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        bool windowed = false,
        CancellationToken cancellationToken = default) {
        var usable = points
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0 && point.DecisionQuality > 0)
            .ToList();

        if (usable.Count < 2) {
            return Fail("Need at least two successful encode-grid points to derive a ladder");
        }

        try {
            var hulls = BuildResolutionHulls(usable);
            if (hulls.Count == 0) {
                return Fail("No resolution produced a usable rate-quality curve");
            }

            // The upper envelope across every resolution — the convex hull in the thesis sense.
            // Both the on-hull flags and the crossovers read off this one curve.
            var envelope = BuildEnvelope(hulls);
            MarkGlobalHull(envelope, points);

            var lambda = ChooseLambda(hulls);
            var selected = SelectOperatingPoints(hulls, lambda);
            if (selected.Count == 0) {
                return Fail("No operating point survived hull selection");
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
                Variants = derivedVariants,
                Lambda = lambda,
                CrossoverBps = FindCrossovers(hulls, envelope),
                Windowed = windowed
            };

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { EncodeGrid = points.ToList(), DerivedLadder = document },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(document),
                cancellationToken);

            _logger.LogInformation(
                "Derived dynamic ladder with {Count} rungs at lambda={Lambda:0.###} for static transcode {TranscodeId}",
                variants.Count,
                lambda,
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

    // ---- Hull construction -------------------------------------------------------------------

    /// <summary>
    /// One upper convex hull per resolution, in (log₂ bitrate, quality) space.
    /// </summary>
    /// <remarks>
    /// Log-rate is the standard rate-distortion domain: it is what makes a hull segment's slope
    /// mean "quality per doubling of bitrate", a quantity comparable across resolutions, and it is
    /// what BD-rate integrates over. Building the hull per resolution rather than over the pooled
    /// point cloud is also what keeps every resolution represented — a single global sweep lets a
    /// strong resolution shadow a weaker one entirely, leaving it with no operating point at all.
    /// </remarks>
    internal static List<ResolutionHull> BuildResolutionHulls(IReadOnlyList<EncodeGridPoint> usable) {
        return usable
            .GroupBy(point => point.Height)
            .Where(group => group.Any())
            .Select(group => new ResolutionHull(
                group.Key,
                group.First().Label,
                group.First().Width,
                UpperHull(group.OrderBy(point => point.BitrateBps).ToList())))
            .Where(hull => hull.Points.Count > 0)
            .OrderByDescending(hull => hull.Height)
            .ToList();
    }

    /// <summary>
    /// Andrew's monotone chain over (log₂ R, Q), keeping only the upper chain: the points no
    /// mixture of two other points beats. Dominated samples — more bits for less quality, which
    /// CRF sweeps do produce — fall out here.
    /// </summary>
    private static List<EncodeGridPoint> UpperHull(List<EncodeGridPoint> ordered) {
        var hull = new List<EncodeGridPoint>();

        foreach (var point in ordered) {
            // Same bitrate as the last kept point: keep whichever scores higher.
            if (hull.Count > 0 && Math.Abs(LogRate(point) - LogRate(hull[^1])) < 1e-9) {
                if (point.DecisionQuality > hull[^1].DecisionQuality) {
                    hull[^1] = point;
                }

                continue;
            }

            // A point costing more for no more quality is dominated and never optimal. Checked
            // before any popping, so a noisy sample cannot evict a good vertex on its way out.
            if (hull.Count > 0 && point.DecisionQuality <= hull[^1].DecisionQuality) {
                continue;
            }

            while (hull.Count >= 2 && !TurnsDown(hull[^2], hull[^1], point)) {
                hull.RemoveAt(hull.Count - 1);
            }

            hull.Add(point);
        }

        return hull;
    }

    /// <summary>True when b lies above the line a→c, i.e. the chain stays concave.</summary>
    private static bool TurnsDown(EncodeGridPoint a, EncodeGridPoint b, EncodeGridPoint c) {
        var cross =
            (LogRate(b) - LogRate(a)) * (c.DecisionQuality - a.DecisionQuality) -
            (b.DecisionQuality - a.DecisionQuality) * (LogRate(c) - LogRate(a));

        return cross < -1e-12;
    }

    private static double LogRate(EncodeGridPoint point) => Math.Log2(point.BitrateBps);

    /// <summary>The upper convex hull spanning every resolution.</summary>
    private static List<EncodeGridPoint> BuildEnvelope(List<ResolutionHull> hulls) =>
        UpperHull(hulls.SelectMany(hull => hull.Points).OrderBy(LogRate).ToList());

    /// <summary>
    /// Flags every grid point on the envelope, so the analysis UI can draw the hull through the
    /// scatter.
    /// </summary>
    private static void MarkGlobalHull(List<EncodeGridPoint> envelope, IReadOnlyList<EncodeGridPoint> all) {
        foreach (var point in all) {
            point.OnHull = false;
        }

        foreach (var point in envelope) {
            point.OnHull = true;
        }
    }

    /// <summary>
    /// Bitrates at which the global hull hands over from one resolution to the next — the
    /// crossover points. On a convex hull these need no interpolation or search: they are simply
    /// where consecutive hull vertices change resolution.
    /// </summary>
    private static Dictionary<string, long>? FindCrossovers(
        List<ResolutionHull> hulls,
        List<EncodeGridPoint> envelope) {
        var labelOf = hulls.ToDictionary(hull => hull.Height, hull => hull.Label);
        var crossovers = new Dictionary<string, long>();

        for (var i = 0; i < envelope.Count - 1; i++) {
            var lower = envelope[i];
            var upper = envelope[i + 1];
            if (lower.Height == upper.Height) {
                continue;
            }

            var key = $"{labelOf.GetValueOrDefault(upper.Height, upper.Height.ToString())}>" +
                      $"{labelOf.GetValueOrDefault(lower.Height, lower.Height.ToString())}";
            crossovers[key] = upper.BitrateBps;
        }

        return crossovers.Count > 0 ? crossovers : null;
    }

    // ---- Lagrangian selection ----------------------------------------------------------------

    /// <summary>
    /// Picks the Lagrange multiplier λ: the base slope, pulled back only far enough to keep the top
    /// rung inside its quality range.
    /// </summary>
    /// <remarks>
    /// For a given λ, maximizing Q − λ·log₂(R) on a concave hull lands on the vertex where the
    /// local slope crosses λ, so one λ across every resolution makes all rungs share the same
    /// quality-per-bit trade-off. That equal-slope condition is the actual optimality criterion
    /// behind convex-hull ladder design: picking each rung at a fixed target score instead spends
    /// bits unevenly, over-paying wherever that resolution's curve happens to be flat.
    /// </remarks>
    internal static double ChooseLambda(List<ResolutionHull> hulls) {
        var top = hulls[0];
        var reachable = top.Points.Max(point => point.DecisionQuality);
        var lambda = LambdaBaseSlope;

        // Larger λ prices bits higher, so it selects a cheaper, lower-quality vertex.
        if (Optimal(top, lambda).DecisionQuality > TopRungCeiling) {
            lambda = Search(top, TopRungCeiling, lambda, lambda * 64);
        } else if (Optimal(top, lambda).DecisionQuality < Math.Min(TopRungFloor, reachable)) {
            lambda = Search(top, Math.Min(TopRungFloor, reachable), lambda / 64, lambda);
        }

        return lambda;

        // Bisects for the largest λ — the cheapest ladder — whose top rung still clears `target`.
        static double Search(ResolutionHull top, double target, double low, double high) {
            for (var i = 0; i < 60; i++) {
                var mid = (low + high) / 2;
                if (Optimal(top, mid).DecisionQuality >= target) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            return low;
        }
    }

    /// <summary>The hull vertex maximizing Q − λ·log₂(R).</summary>
    private static EncodeGridPoint Optimal(ResolutionHull hull, double lambda) => hull.Points
        .OrderByDescending(point => point.DecisionQuality - lambda * LogRate(point))
        .ThenBy(point => point.BitrateBps)
        .First();

    /// <summary>
    /// One rung per resolution at the shared λ, dropping any resolution a lower one already beats
    /// at that bitrate, then enforcing spacing and monotonicity.
    /// </summary>
    private static List<SelectedRung> SelectOperatingPoints(List<ResolutionHull> hulls, double lambda) {
        var selected = new List<SelectedRung>();

        foreach (var hull in hulls.OrderByDescending(hull => hull.Height)) {
            var point = Optimal(hull, lambda);
            var slope = LocalSlope(hull, point);

            // Below its crossover a resolution is simply the wrong choice: some lower resolution
            // reaches the same or better quality at the same bitrate. Shipping the rung anyway is
            // what a fixed-target ladder does, and it is exactly the waste this is meant to avoid.
            var beaten = hulls.Any(other =>
                other.Height < hull.Height &&
                QualityAt(other, LogRate(point)) > point.DecisionQuality + 1e-6);

            if (beaten && selected.Count > 0) {
                continue;
            }

            selected.Add(new SelectedRung(hull, point, point.BitrateBps, slope));
        }

        return Space(selected);
    }

    /// <summary>
    /// Forces bitrate to fall with resolution and adjacent rungs to stay a real distance apart,
    /// dropping rungs that collapse into their neighbour.
    /// </summary>
    /// <remarks>
    /// A rung too close to the one above is re-selected onto a cheaper vertex of its own hull
    /// rather than simply having its bitrate written down. Rewriting the number would leave the
    /// rung's reported CRF and predicted quality describing an operating point that is not the one
    /// being shipped — the ladder would be audited against a measurement it no longer corresponds
    /// to. Re-selecting keeps every published rung backed by a real grid sample.
    /// </remarks>
    private static List<SelectedRung> Space(List<SelectedRung> selected) {
        var spaced = new List<SelectedRung>();

        foreach (var rung in selected.OrderByDescending(item => item.Hull.Height)) {
            if (spaced.Count == 0) {
                spaced.Add(rung);
                continue;
            }

            var ceiling = (long)(spaced[^1].BitrateBps / MinRungSpacing);
            if (rung.BitrateBps <= ceiling) {
                spaced.Add(rung);
                continue;
            }

            var cheaper = rung.Hull.Points
                .Where(point => point.BitrateBps <= ceiling && point.BitrateBps >= BitrateFloorBps)
                .MaxBy(point => point.BitrateBps);

            // Nothing on this resolution's hull is cheap enough to sit clear of the rung above, so
            // it would offer an ABR algorithm no meaningful alternative.
            if (cheaper != null) {
                spaced.Add(rung with {
                    Point = cheaper,
                    BitrateBps = cheaper.BitrateBps,
                    Slope = LocalSlope(rung.Hull, cheaper)
                });
            }
        }

        return spaced;
    }

    /// <summary>Quality the resolution reaches at a given log-bitrate, interpolated along its hull.</summary>
    private static double QualityAt(ResolutionHull hull, double logRate) {
        var points = hull.Points;
        if (logRate <= LogRate(points[0])) {
            return double.NegativeInfinity;
        }

        if (logRate >= LogRate(points[^1])) {
            return points[^1].DecisionQuality;
        }

        for (var i = 0; i < points.Count - 1; i++) {
            var low = LogRate(points[i]);
            var high = LogRate(points[i + 1]);
            if (logRate < low || logRate > high) {
                continue;
            }

            var t = (logRate - low) / (high - low);
            return points[i].DecisionQuality + t * (points[i + 1].DecisionQuality - points[i].DecisionQuality);
        }

        return points[^1].DecisionQuality;
    }

    private static double? LocalSlope(ResolutionHull hull, EncodeGridPoint point) {
        var index = hull.Points.IndexOf(point);
        if (index < 0 || hull.Points.Count < 2) {
            return null;
        }

        var (a, b) = index == 0
            ? (hull.Points[0], hull.Points[1])
            : (hull.Points[index - 1], hull.Points[index]);

        var run = LogRate(b) - LogRate(a);
        return run > 1e-9 ? (b.DecisionQuality - a.DecisionQuality) / run : null;
    }

    // ---- Output ------------------------------------------------------------------------------

    private static (List<TranscodeVariant> Variants, List<DerivedLadderVariant> Derived) BuildVariants(
        List<SelectedRung> selected) {
        var variants = new List<TranscodeVariant>();
        var derived = new List<DerivedLadderVariant>();

        foreach (var rung in selected.OrderByDescending(item => item.Hull.Height)) {
            var kbps = Math.Max(
                BitrateFloorBps / 1000,
                (long)Math.Round(rung.BitrateBps / 1000.0 / RoundToKbps) * RoundToKbps);

            var bitrate = $"{kbps}k";
            var resolution = $"{rung.Hull.Width}:{rung.Hull.Height}";

            variants.Add(new TranscodeVariant(resolution, bitrate, rung.Hull.Label));
            derived.Add(new DerivedLadderVariant {
                Label = rung.Hull.Label,
                Resolution = resolution,
                Bitrate = bitrate,
                BitrateBps = kbps * 1000L,
                PredictedVmaf = rung.Point.VmafMean,
                PredictedVmafHarmonic = rung.Point.VmafHarmonicMean,
                PredictedVmafMin = rung.Point.VmafMin,
                Crf = rung.Point.Crf,
                HullSlope = rung.Slope
            });
        }

        // Cover any default rung whose resolution never produced a usable curve.
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

    private static AnalysisTreeNode BuildSection(DerivedLadderDocument document) {
        var children = document.Variants
            .Select(variant => Leaf(
                $"derivedLadder.{variant.Label}",
                variant.Label,
                variant.PredictedVmafHarmonic != null
                    ? $"{variant.Bitrate} (CRF {variant.Crf}, pred. harm. VMAF {Format(variant.PredictedVmafHarmonic)})"
                    : variant.Bitrate))
            .ToList();

        children.Insert(0, Leaf("derivedLadder.lambda", "Hull slope (λ)", Format(document.Lambda)));

        foreach (var (pair, bitrate) in document.CrossoverBps ?? []) {
            children.Add(Leaf(
                $"derivedLadder.crossover.{pair}",
                $"Crossover {pair.Replace(">", " → ")}",
                MediaFormatting.FormatBitrate(bitrate)));
        }

        return Section(
            "derivedLadder",
            "Derived ladder (VMAF crossover)",
            "ladder-derivation",
            AnalysisSectionStatus.Completed,
            children: children);

        static string Format(double? value) =>
            value?.ToString("0.##", CultureInfo.InvariantCulture) ?? "—";
    }

    private static LadderDerivationResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };

    /// <summary>One resolution's rate-quality curve, reduced to its upper convex hull.</summary>
    internal sealed record ResolutionHull(int Height, string Label, int Width, List<EncodeGridPoint> Points);

    /// <summary>
    /// A chosen rung. Bitrate is carried here rather than written back onto the grid point, so the
    /// measured RD data stays exactly as it was measured.
    /// </summary>
    private sealed record SelectedRung(ResolutionHull Hull, EncodeGridPoint Point, long BitrateBps, double? Slope);
}
