using System.Globalization;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>What distinguishes one derivation run from another.</summary>
/// <param name="ProfileName">Name stamped on the emitted profile and used as its provenance.</param>
/// <param name="Recipe">Encoder settings the grid was measured under and packaging must repeat.</param>
/// <param name="CambiPenaltyWeight">
/// VMAF points deducted per unit of CAMBI when ranking candidates. Zero leaves selection on VMAF
/// alone; the animation run raises it so banding on flat cel-shaded areas — which VMAF scarcely
/// registers — actually costs a candidate something.
/// </param>
/// <param name="SeriesKey">Which series field the result is stored under.</param>
public sealed record LadderDerivationOptions(
    string ProfileName,
    EncodeRecipe Recipe,
    double CambiPenaltyWeight = 0,
    string SeriesKey = "derivedLadder") {
    public static readonly LadderDerivationOptions Dynamic =
        new("vmaf-crossover", EncodeRecipe.Default);

    public static readonly LadderDerivationOptions Animation =
        new("animation-tuned", EncodeRecipe.Animation, CambiPenaltyWeight: 0.5, SeriesKey: "animationLadder");
}

public sealed class LadderDerivationResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public TranscodeProfile? Profile { get; init; }
    public DerivedLadderDocument? Document { get; init; }
}

/// <summary>
/// Derives a content-specific bitrate ladder from encode-grid RD points: one rung per resolution,
/// every rung taken at a shared hull slope λ and held inside the bitrate window where its
/// resolution is actually the best choice.
/// </summary>
/// <remarks>
/// The window constraint is what makes this a convex-hull ladder rather than a set of independent
/// per-resolution picks. The first full run selected each resolution at λ in isolation and only
/// asked whether a <em>lower</em> resolution beat the result; nothing stopped a low resolution
/// being placed above the bitrate where the next one up takes over. Four of five rungs ended up
/// off the hull (480p at 1.9 Mb/s where 720p is several VMAF points better at the same rate) and
/// the "content-adaptive" ladder measured worse than the fixed one.
/// </remarks>
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
    /// for quality no viewer can distinguish; the floor stops exceptionally hard
    /// content from shipping a top rung that is visibly poor when the hull could do better.
    /// </summary>
    private const double TopRungCeiling = 95.0;
    private const double TopRungFloor = 88.0;

    /// <summary>
    /// Harmonic-mean VMAF below which a grid sample is left out of hull construction.
    /// </summary>
    /// <remarks>
    /// VMAF is clipped at zero, so below roughly 20 the harmonic mean is driven by clipped frames
    /// (240p at CRF 40 scored a mean of 0.64 and a harmonic mean of 0.10) and the curve's slope
    /// measures clipping rather than rate. Such points also anchored the convex hull, producing
    /// crossovers like "480p over 240p at 726 kb/s" that described nothing real. The floor stays
    /// low on purpose: under the HD model 240p tops out near 45 and 360p wins only between roughly
    /// 25 and 45, so a higher floor would delete a resolution by fiat instead of letting the
    /// envelope decide.
    /// </remarks>
    internal const double QualityFloor = 20.0;

    /// <summary>
    /// Adjacent rungs must differ by at least this factor in bitrate. Two rungs a few percent
    /// apart give an ABR algorithm nothing to choose between while costing a full extra encode.
    /// </summary>
    private const double MinRungSpacing = 1.5;

    /// <summary>Adjacent rungs further apart than this are reported: one rung per resolution cannot fill the gap.</summary>
    private const double GapRatioWarning = 2.5;
    private const double GapQualityWarning = 20.0;

    private const long BitrateFloorBps = 100_000;

    /// <summary>
    /// Rounding applied to the shipped bitrates. 50 kb/s used to be used, which at 373 kb/s is ±7 %
    /// — about 2.6 VMAF on a curve climbing 26 points per doubling.
    /// </summary>
    private const int RoundToKbps = 10;

    /// <summary>How finely the log-rate axis is scanned to find where each resolution wins.</summary>
    private const int EnvelopeSamples = 4000;

    /// <summary>Relative slack on bitrate comparisons against window bounds, which are computed in floating point.</summary>
    private const double RateTolerance = 1e-6;

    /// <summary>CAMBI weights the animation ladder is re-derived under, to show how much the chosen weight matters.</summary>
    internal static readonly double[] SensitivityWeights = [0, 0.5, 1, 2];

    private readonly AnalysisStore _store;
    private readonly ILogger<LadderDerivation> _logger;

    public LadderDerivation(AnalysisStore store, ILogger<LadderDerivation> logger) {
        _store = store;
        _logger = logger;
    }

    public async Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        LadderDerivationOptions options,
        CancellationToken cancellationToken = default) {
        // Persisted with the points, so the stored grid reproduces exactly the decisions made here.
        foreach (var point in points) {
            point.CambiPenaltyWeight = options.CambiPenaltyWeight;
        }

        try {
            var plan = Plan(points);
            if (plan.Error != null) {
                return Fail(plan.Error);
            }

            MarkGlobalHull(plan.PooledHull, points);

            var (variants, derivedVariants) = BuildVariants(plan, points);

            var profile = new TranscodeProfile {
                Name = options.ProfileName,
                Variants = variants,
                VideoCodec = TranscodeProfile.Default.VideoCodec,
                AudioCodec = TranscodeProfile.Default.AudioCodec,
                AudioBitrate = TranscodeProfile.Default.AudioBitrate,
                SegmentDurationSeconds = TranscodeProfile.Default.SegmentDurationSeconds,
                // Packaging must repeat the settings the grid was measured under.
                Tune = options.Recipe.Tune,
                Decimate = options.Recipe.Decimate
            };

            var document = BuildDocument(plan, profile.Name, derivedVariants, options.CambiPenaltyWeight);
            var sensitivity = options.CambiPenaltyWeight > 0 ? Sensitivity(points) : null;

            var animation = options.SeriesKey != "derivedLadder";
            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                animation
                    ? new AnalysisSeriesDocument {
                        EncodeGridAnimation = points.ToList(),
                        AnimationLadder = document,
                        AnimationLadderSensitivity = sensitivity
                    }
                    : new AnalysisSeriesDocument { EncodeGrid = points.ToList(), DerivedLadder = document },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(document, options),
                cancellationToken);

            _logger.LogInformation(
                "Derived {Name} ladder with {Count} rungs at lambda={Lambda:0.###} for static transcode {TranscodeId}; dropped: {Dropped}; warnings: {Warnings}",
                options.ProfileName,
                plan.Rungs.Count,
                plan.Lambda,
                staticTranscodeId,
                plan.Dropped.Count == 0 ? "none" : string.Join(", ", plan.Dropped.Keys),
                plan.Warnings.Count);

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

    // ---- Planning (pure) ---------------------------------------------------------------------

    /// <summary>
    /// Decides the ladder from grid points without touching them or the store. The encode grid
    /// calls this between samples to aim its refinement at the rungs and crossovers the final
    /// derivation will read, so the two can never disagree about where the ladder is.
    /// </summary>
    internal static LadderPlan Plan(IReadOnlyList<EncodeGridPoint> points, double qualityFloor = QualityFloor) {
        var usable = points.Where(point => IsUsable(point, qualityFloor)).ToList();
        if (usable.Count < 2) {
            return LadderPlan.Failed("Need at least two successful encode-grid points above the quality floor to derive a ladder");
        }

        var hulls = BuildResolutionHulls(usable);
        if (hulls.Count == 0) {
            return LadderPlan.Failed("No resolution produced a usable rate-quality curve");
        }

        var envelope = MaxEnvelope(hulls);
        var top = hulls.FirstOrDefault(hull => envelope.Windows.ContainsKey(hull.Height));
        if (top == null) {
            return LadderPlan.Failed("No resolution wins anywhere on the envelope");
        }

        var pooledHull = UpperHull(hulls.SelectMany(hull => hull.Points).OrderBy(LogRate).ToList());
        var lambda = ChooseLambda(top);
        var dropped = new Dictionary<string, string>();
        var emptyWindows = new List<EnvelopeWindow>();
        var warnings = new List<string>();
        var rungs = new List<PlannedRung>();

        var lowestCrf = points
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0)
            .GroupBy(point => point.Height)
            .ToDictionary(group => group.Key, group => group.Min(point => point.Crf));

        foreach (var hull in hulls) {
            if (!envelope.Windows.TryGetValue(hull.Height, out var window)) {
                dropped[hull.Label] = "never the best resolution at any bitrate above the quality floor";
                continue;
            }

            if (window.Fragmented) {
                warnings.Add($"{hull.Label} wins in more than one disjoint bitrate range; the highest one is used.");
            }

            var isTop = ReferenceEquals(hull, top);
            var point = Optimal(hull, lambda);

            // Above its window a lower resolution is simply the wrong choice: the next one up is
            // better at that bitrate. Only the top resolution has no ceiling.
            double? cap = isTop ? null : window.HighBps;
            var capped = cap is { } limit && !double.IsInfinity(limit) && Exceeds(point.BitrateBps, limit);

            if (capped) {
                point = hull.Points
                    .Where(candidate => !Exceeds(candidate.BitrateBps, cap!.Value))
                    .MaxBy(candidate => candidate.BitrateBps);
            }

            if (isTop && point != null && FallsShort(point.BitrateBps, window.LowBps)) {
                point = hull.Points
                    .Where(candidate => !FallsShort(candidate.BitrateBps, window.LowBps))
                    .MinBy(candidate => candidate.BitrateBps);
            }

            if (point == null || FallsShort(point.BitrateBps, window.LowBps)) {
                dropped[hull.Label] = "no measured sample inside the bitrate window where it is the best resolution";
                emptyWindows.Add(window);
                continue;
            }

            var slope = LocalSlope(hull, point);
            var atBoundary =
                !capped &&
                ReferenceEquals(point, hull.Points[^1]) &&
                lowestCrf.TryGetValue(hull.Height, out var minCrf) &&
                point.Crf == minCrf &&
                (slope == null || slope > lambda) &&
                !(isTop && point.DecisionQuality >= TopRungCeiling);

            rungs.Add(new PlannedRung(
                hull,
                point,
                slope,
                capped,
                atBoundary,
                cap is { } c && !double.IsInfinity(c) ? c : null,
                window,
                HullDeficit(pooledHull, point)));
        }

        var spaced = Space(rungs, pooledHull, dropped);
        if (spaced.Count == 0) {
            return LadderPlan.Failed("No operating point survived selection");
        }

        warnings.AddRange(GapWarnings(spaced));

        return new LadderPlan(null, lambda, hulls, spaced, envelope, pooledHull, dropped, emptyWindows, warnings);
    }

    private static bool IsUsable(EncodeGridPoint point, double qualityFloor) =>
        string.IsNullOrEmpty(point.Error) &&
        point.BitrateBps > 0 &&
        point.RawQuality >= qualityFloor &&
        point.DecisionQuality > 0;

    private static bool Exceeds(long bps, double bound) => bps > bound * (1 + RateTolerance);

    private static bool FallsShort(long bps, double bound) => bps < bound * (1 - RateTolerance);

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

    internal static double LogRate(EncodeGridPoint point) => Math.Log2(point.BitrateBps);

    /// <summary>
    /// Flags every grid point on the pooled convex hull, so the analysis UI can draw the hull
    /// through the scatter.
    /// </summary>
    private static void MarkGlobalHull(List<EncodeGridPoint> pooledHull, IReadOnlyList<EncodeGridPoint> all) {
        foreach (var point in all) {
            point.OnHull = false;
        }

        foreach (var point in pooledHull) {
            point.OnHull = true;
        }
    }

    // ---- Envelope ----------------------------------------------------------------------------

    /// <summary>
    /// The bitrate window in which each resolution delivers the highest quality, and the
    /// crossovers where one window hands over to the next.
    /// </summary>
    /// <remarks>
    /// Found by scanning log-rate and asking which resolution's hull is highest, then bisecting each
    /// change of winner to machine precision. That is the actual intersection of the curves; the
    /// earlier approach read crossovers off consecutive vertices of the pooled convex hull, which
    /// bridges concave stretches with a straight line and so reports hand-overs at bitrates where
    /// neither resolution was sampled.
    /// </remarks>
    internal static Envelope MaxEnvelope(List<ResolutionHull> hulls) {
        var low = hulls.Min(hull => LogRate(hull.Points[0]));
        var high = hulls.Max(hull => LogRate(hull.Points[^1]));
        var steps = high - low < 1e-9 ? 0 : EnvelopeSamples;
        var runs = new List<Run>();

        for (var i = 0; i <= steps; i++) {
            var x = steps == 0 ? low : low + (high - low) * i / steps;
            var winner = WinnerAt(hulls, x);
            if (winner == null) {
                continue;
            }

            if (runs.Count > 0 && runs[^1].Height == winner.Value) {
                runs[^1].End = x;
                continue;
            }

            if (runs.Count == 0) {
                runs.Add(new Run { Height = winner.Value, Start = x, End = x });
                continue;
            }

            var previous = runs[^1];
            var boundary = Bisect(previous.End, x, candidate => WinnerAt(hulls, candidate) == previous.Height);
            previous.End = boundary;
            runs.Add(new Run { Height = winner.Value, Start = boundary, End = x });
        }

        var windows = new Dictionary<int, EnvelopeWindow>();
        foreach (var group in runs.GroupBy(run => run.Height)) {
            // A resolution that wins in two disjoint ranges keeps the higher one: the lower range
            // is where a noisy sample briefly edged ahead, not where it belongs in a ladder.
            var kept = group.MaxBy(run => run.End)!;
            var hull = hulls.First(item => item.Height == group.Key);
            windows[group.Key] = new EnvelopeWindow(
                group.Key,
                hull.Label,
                Math.Pow(2, kept.Start),
                kept.End >= high - 1e-12 ? double.PositiveInfinity : Math.Pow(2, kept.End),
                group.Count() > 1);
        }

        var ordered = windows.Values.OrderBy(window => window.LowBps).ToList();
        var crossovers = new List<Crossover>();
        for (var i = 0; i + 1 < ordered.Count; i++) {
            var lower = ordered[i];
            var upper = ordered[i + 1];
            var lowerTop = hulls.First(hull => hull.Height == lower.Height).Points[^1].BitrateBps;

            crossovers.Add(new Crossover(
                $"{upper.Label}>{lower.Label}",
                upper.Height,
                lower.Height,
                (long)Math.Round(upper.LowBps),
                // Past the lower curve's last sample its quality is extended flat, so a crossover
                // there rests on that assumption rather than on a measurement.
                upper.LowBps > lowerTop * (1 + RateTolerance)));
        }

        return new Envelope(windows, crossovers);
    }

    private static int? WinnerAt(List<ResolutionHull> hulls, double logRate) {
        int? best = null;
        var bestQuality = double.NegativeInfinity;

        // Hulls are ordered highest resolution first, so an exact tie keeps the higher one.
        foreach (var hull in hulls) {
            var quality = QualityAt(hull.Points, logRate);
            if (quality > bestQuality + 1e-9) {
                bestQuality = quality;
                best = hull.Height;
            }
        }

        return double.IsNegativeInfinity(bestQuality) ? null : best;
    }

    private static double Bisect(double left, double right, Func<double, bool> isLeft) {
        for (var i = 0; i < 60; i++) {
            var mid = (left + right) / 2;
            if (isLeft(mid)) {
                left = mid;
            } else {
                right = mid;
            }
        }

        return (left + right) / 2;
    }

    /// <summary>
    /// Quality along a piecewise-linear curve at a given log-bitrate: undefined below its first
    /// vertex, flat past its last, interpolated between.
    /// </summary>
    private static double QualityAt(IReadOnlyList<EncodeGridPoint> points, double logRate) {
        if (points.Count == 0 || logRate < LogRate(points[0]) - 1e-12) {
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

            var t = high - low < 1e-12 ? 0 : (logRate - low) / (high - low);
            return points[i].DecisionQuality + t * (points[i + 1].DecisionQuality - points[i].DecisionQuality);
        }

        return points[^1].DecisionQuality;
    }

    /// <summary>How far a rung sits below the pooled convex hull at its own bitrate — zero on the hull.</summary>
    private static double HullDeficit(List<EncodeGridPoint> pooledHull, EncodeGridPoint point) {
        var hullQuality = QualityAt(pooledHull, LogRate(point));
        return double.IsNegativeInfinity(hullQuality) ? 0 : Math.Max(0, hullQuality - point.DecisionQuality);
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
    internal static double ChooseLambda(ResolutionHull top) {
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
    /// Forces bitrate to fall with resolution and adjacent rungs to stay a real distance apart,
    /// dropping rungs that collapse into their neighbour.
    /// </summary>
    /// <remarks>
    /// A rung too close to the one above is re-selected onto a cheaper vertex of its own hull
    /// rather than simply having its bitrate written down. Rewriting the number would leave the
    /// rung's reported CRF and predicted quality describing an operating point that is not the one
    /// being shipped — the ladder would be audited against a measurement it no longer corresponds
    /// to. Re-selecting keeps every published rung backed by a real grid sample, and it may never
    /// leave the resolution's envelope window.
    /// </remarks>
    private static List<PlannedRung> Space(
        List<PlannedRung> rungs,
        List<EncodeGridPoint> pooledHull,
        Dictionary<string, string> dropped) {
        var spaced = new List<PlannedRung>();

        foreach (var rung in rungs.OrderByDescending(item => item.Hull.Height)) {
            if (spaced.Count == 0) {
                spaced.Add(rung);
                continue;
            }

            var ceiling = spaced[^1].Point.BitrateBps / MinRungSpacing;
            if (rung.Point.BitrateBps <= ceiling) {
                spaced.Add(rung);
                continue;
            }

            var cheaper = rung.Hull.Points
                .Where(point =>
                    point.BitrateBps <= ceiling &&
                    point.BitrateBps >= BitrateFloorBps &&
                    !FallsShort(point.BitrateBps, rung.Window.LowBps))
                .MaxBy(point => point.BitrateBps);

            // Nothing on this resolution's hull is cheap enough to sit clear of the rung above
            // while staying where the resolution wins, so it would offer an ABR algorithm no
            // meaningful alternative.
            if (cheaper == null) {
                dropped[rung.Hull.Label] =
                    $"no sample inside its window at least ×{MinRungSpacing} below {spaced[^1].Hull.Label}";
                continue;
            }

            spaced.Add(rung with {
                Point = cheaper,
                Slope = LocalSlope(rung.Hull, cheaper),
                Capped = true,
                AtGridBoundary = false,
                CapBps = ceiling,
                HullDeficit = HullDeficit(pooledHull, cheaper)
            });
        }

        return spaced;
    }

    private static IEnumerable<string> GapWarnings(List<PlannedRung> rungs) {
        for (var i = 1; i < rungs.Count; i++) {
            var upper = rungs[i - 1].Point;
            var lower = rungs[i].Point;
            var ratio = (double)upper.BitrateBps / lower.BitrateBps;
            var qualityGap = upper.RawQuality - lower.RawQuality;

            if (ratio > GapRatioWarning || qualityGap > GapQualityWarning) {
                yield return string.Create(
                    CultureInfo.InvariantCulture,
                    $"Gap between {rungs[i - 1].Hull.Label} and {rungs[i].Hull.Label}: ×{ratio:0.0} in bitrate, {qualityGap:0.#} VMAF. One rung per resolution cannot fill it.");
            }
        }
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
        LadderPlan plan,
        IReadOnlyList<EncodeGridPoint> allPoints) {
        var variants = new List<TranscodeVariant>();
        var derived = new List<DerivedLadderVariant>();

        foreach (var rung in plan.Rungs.OrderByDescending(item => item.Hull.Height)) {
            var kbps = Math.Max(
                BitrateFloorBps / 1000,
                (long)Math.Round(rung.Point.BitrateBps / 1000.0 / RoundToKbps) * RoundToKbps);

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
                HullSlope = rung.Slope,
                OnEnvelope = true,
                HullDeficit = Math.Round(rung.HullDeficit, 3),
                Capped = rung.Capped,
                CapBps = rung.CapBps is { } cap ? (long)Math.Round(cap) : null,
                AtGridBoundary = rung.AtGridBoundary
            });
        }

        // A default rung is re-added only for a resolution that produced no measurement at all.
        // A resolution that was measured and dropped is left out on purpose — re-adding it would
        // put back exactly the off-envelope rung the envelope rule removed.
        var measuredHeights = allPoints
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0)
            .Select(point => point.Height)
            .ToHashSet();

        foreach (var fallback in TranscodeProfile.Default.Variants) {
            if (variants.Any(variant => string.Equals(variant.Label, fallback.Label, StringComparison.OrdinalIgnoreCase))) {
                continue;
            }

            if (MediaFormatting.ParseResolution(fallback.Resolution) is { } size && measuredHeights.Contains(size.Height)) {
                continue;
            }

            variants.Add(fallback);
            derived.Add(new DerivedLadderVariant {
                Label = fallback.Label,
                Resolution = fallback.Resolution,
                Bitrate = fallback.Bitrate,
                BitrateBps = TranscodeProfile.ParseBitrateKbps(fallback.Bitrate) * 1000L,
                Fallback = true
            });
        }

        return (
            variants.OrderByDescending(HeightOf).ToList(),
            derived.OrderByDescending(variant => MediaFormatting.ParseResolution(variant.Resolution)?.Height ?? 0).ToList()
        );

        static int HeightOf(TranscodeVariant variant) =>
            MediaFormatting.ParseResolution(variant.Resolution)?.Height ?? 0;
    }

    private static DerivedLadderDocument BuildDocument(
        LadderPlan plan,
        string name,
        List<DerivedLadderVariant> variants,
        double cambiPenaltyWeight) {
        var crossovers = plan.Envelope.Crossovers;

        return new DerivedLadderDocument {
            Name = name,
            Variants = variants,
            Lambda = plan.Lambda,
            CrossoverBps = crossovers.Count > 0
                ? crossovers.GroupBy(item => item.Key).ToDictionary(group => group.Key, group => group.Last().BitrateBps)
                : null,
            Crossovers = crossovers.Count > 0
                ? crossovers.Select(item => new CrossoverInfo {
                    Key = item.Key,
                    BitrateBps = item.BitrateBps,
                    Extrapolated = item.Extrapolated
                }).ToList()
                : null,
            Dropped = plan.Dropped.Count > 0 ? new Dictionary<string, string>(plan.Dropped) : null,
            Warnings = plan.Warnings.Count > 0 ? plan.Warnings.ToList() : null,
            QualityFloor = QualityFloor,
            CambiPenaltyWeight = cambiPenaltyWeight
        };
    }

    /// <summary>
    /// The ladder re-derived from the same grid under each alternative CAMBI weight. Pure
    /// computation over stored points — it costs no encoding — and it shows whether the chosen
    /// weight changes any decision at all.
    /// </summary>
    internal static List<LadderSensitivityEntry> Sensitivity(IReadOnlyList<EncodeGridPoint> points) {
        var entries = new List<LadderSensitivityEntry>();

        foreach (var weight in SensitivityWeights) {
            var weighted = points.Select(point => point.WithPenaltyWeight(weight)).ToList();
            var plan = Plan(weighted);
            if (plan.Error != null) {
                entries.Add(new LadderSensitivityEntry { Weight = weight, Error = plan.Error });
                continue;
            }

            var (_, derived) = BuildVariants(plan, weighted);
            entries.Add(new LadderSensitivityEntry {
                Weight = weight,
                Lambda = plan.Lambda,
                Variants = derived.Where(variant => variant.Fallback != true).ToList()
            });
        }

        return entries;
    }

    private static AnalysisTreeNode BuildSection(
        DerivedLadderDocument document,
        LadderDerivationOptions options) {
        var key = options.SeriesKey;

        var children = document.Variants
            .Select(variant => Leaf(
                $"{key}.{variant.Label}",
                variant.Label,
                variant.PredictedVmafHarmonic != null
                    ? $"{variant.Bitrate} (CRF {variant.Crf}, pred. harm. VMAF {Format(variant.PredictedVmafHarmonic)})" +
                      (variant.Capped == true ? ", capped at crossover" : "") +
                      (variant.AtGridBoundary == true ? ", at grid edge" : "")
                    : variant.Fallback == true
                        ? $"{variant.Bitrate} (default — no measurement)"
                        : variant.Bitrate))
            .ToList();

        children.Insert(0, Leaf($"{key}.lambda", "Hull slope (λ)", Format(document.Lambda)));
        children.Insert(1, Leaf($"{key}.floor", "Quality floor (harm. VMAF)", Format(document.QualityFloor)));

        if (options.CambiPenaltyWeight > 0) {
            children.Insert(2, Leaf(
                $"{key}.cambiPenalty",
                "CAMBI penalty",
                $"{Format(options.CambiPenaltyWeight)} VMAF per CAMBI unit"));
        }

        foreach (var crossover in document.Crossovers ?? []) {
            children.Add(Leaf(
                $"{key}.crossover.{crossover.Key}",
                $"Crossover {crossover.Key.Replace(">", " → ")}",
                MediaFormatting.FormatBitrate(crossover.BitrateBps) + (crossover.Extrapolated ? " (extrapolated)" : "")));
        }

        foreach (var (droppedLabel, reason) in document.Dropped ?? []) {
            children.Add(Leaf($"{key}.dropped.{droppedLabel}", $"{droppedLabel} dropped", reason));
        }

        var index = 0;
        foreach (var warning in document.Warnings ?? []) {
            children.Add(Leaf($"{key}.warning.{index++}", "Warning", warning));
        }

        var label = options.Recipe.Tune == null
            ? "Derived ladder (VMAF crossover)"
            : $"Animation-tuned ladder ({options.Recipe.Tune})";

        return Section(
            key,
            label,
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

    /// <summary>The bitrate range in which one resolution delivers the highest quality.</summary>
    internal sealed record EnvelopeWindow(int Height, string Label, double LowBps, double HighBps, bool Fragmented);

    internal sealed record Crossover(string Key, int UpperHeight, int LowerHeight, long BitrateBps, bool Extrapolated);

    internal sealed record Envelope(Dictionary<int, EnvelopeWindow> Windows, List<Crossover> Crossovers);

    /// <summary>
    /// A chosen rung. The grid point is referenced, never written to, so the measured RD data stays
    /// exactly as it was measured.
    /// </summary>
    internal sealed record PlannedRung(
        ResolutionHull Hull,
        EncodeGridPoint Point,
        double? Slope,
        bool Capped,
        bool AtGridBoundary,
        double? CapBps,
        EnvelopeWindow Window,
        double HullDeficit);

    internal sealed record LadderPlan(
        string? Error,
        double Lambda,
        List<ResolutionHull> Hulls,
        List<PlannedRung> Rungs,
        Envelope Envelope,
        List<EncodeGridPoint> PooledHull,
        Dictionary<string, string> Dropped,
        List<EnvelopeWindow> EmptyWindows,
        List<string> Warnings) {
        internal static LadderPlan Failed(string error) =>
            new(error, 0, [], [], new Envelope(new Dictionary<int, EnvelopeWindow>(), []), [], new Dictionary<string, string>(), [], []);
    }

    private sealed class Run {
        public int Height { get; init; }
        public double Start { get; init; }
        public double End { get; set; }
    }
}
