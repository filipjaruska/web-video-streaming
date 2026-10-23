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
/// <param name="Pooled">
/// Derive from this run's grid and the default grid together, each sample tagged with the setting
/// it was encoded under, so every rung can take whichever setting does better at its rate.
/// </param>
/// <param name="CambiLimit">Which rungs must keep their predicted CAMBI under the limit.</param>
public sealed record LadderDerivationOptions(
    string ProfileName,
    EncodeRecipe Recipe,
    double CambiPenaltyWeight = 0,
    string SeriesKey = "derivedLadder",
    bool Pooled = false,
    CambiLimitMode CambiLimit = CambiLimitMode.Off) {
    public static readonly LadderDerivationOptions Dynamic =
        new("vmaf-crossover", EncodeRecipe.Default);

    public static readonly LadderDerivationOptions Animation =
        new("animation-pooled", EncodeRecipe.Animation, CambiPenaltyWeight: 0.5, SeriesKey: "animationLadder", Pooled: true);
}

/// <summary>Which rungs the CAMBI limit (<see cref="LadderDerivation.MaxPredictedCambi"/>) applies to.</summary>
public enum CambiLimitMode {
    Off,
    TopRung,
    AtLeast720p
}

/// <summary>Configuration section <c>LadderDerivation</c>.</summary>
public sealed class LadderDerivationSettings {
    public const string SectionName = "LadderDerivation";

    /// <summary>Which rungs of the animation ladder are held to the CAMBI limit.</summary>
    public CambiLimitMode CambiLimit { get; set; } = CambiLimitMode.Off;
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
/// per-resolution picks. Selecting each resolution at λ in isolation, and only asking whether a
/// <em>lower</em> resolution beats the result, does not stop a low resolution being placed above
/// the bitrate where the next one up takes over — such a rung sits off the hull, where a higher
/// resolution is several VMAF points better at the same rate, and the ladder loses to a fixed one.
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
    /// (the lowest resolutions at high CRF score a harmonic mean well under 1) and the curve's slope
    /// measures clipping rather than rate. Such points would also anchor the convex hull and produce
    /// crossovers that describe nothing real. The floor stays low on purpose: under the HD model the
    /// lowest resolutions top out in the 40s and win only between roughly 25 and 45, so a higher
    /// floor would delete a resolution by fiat instead of letting the envelope decide.
    /// </remarks>
    internal const double QualityFloor = 20.0;

    /// <summary>
    /// Predicted CAMBI a rung held to the limit may not exceed. Netflix's CAMBI documentation puts
    /// the point where banding starts to become slightly annoying at around 5.
    /// </summary>
    internal const double MaxPredictedCambi = 5.0;

    /// <summary>
    /// Adjacent rungs must differ by at least this factor in bitrate. Two rungs a few percent
    /// apart give an ABR algorithm nothing to choose between while costing a full extra encode.
    /// </summary>
    private const double MinRungSpacing = 1.5;

    /// <summary>
    /// Widest step allowed between adjacent rungs; a wider one gets a rung inserted at its geometric
    /// mean (<see cref="Placements.Gap"/>). Just above ×2 the halves come out at about ×1.41, a little
    /// under <see cref="MinRungSpacing"/>, which governs only where λ places a rung.
    /// </summary>
    private const double MaxRungGap = 2.0;

    /// <summary>Adjacent rungs further apart than this are reported: one rung per resolution cannot fill the gap.</summary>
    private const double GapRatioWarning = 2.5;
    private const double GapQualityWarning = 20.0;

    /// <summary>
    /// Lowest bitrate a rung is shipped at — the lower bound of every admissible interval. Enforced
    /// during selection, with the rung's quality predicted at the rate it ships at: raising the
    /// shipped number afterwards left the prediction at the lower rate, and several rungs raised to
    /// the same floor collapsed into identical bitrates.
    /// </summary>
    internal const long BitrateFloorBps = 100_000;

    /// <summary>
    /// Rounding applied to the shipped bitrates. Kept fine: 50 kb/s steps would be ±7 % on a
    /// 370 kb/s rung — about 2.6 VMAF on a curve climbing 26 points per doubling.
    /// </summary>
    private const int RoundToKbps = 10;

    /// <summary>How <see cref="ChooseLambda"/> arrived at λ, stored so the value can be traced back to its rule.</summary>
    internal static class LambdaRules {
        /// <summary>The base slope already put the top rung inside its quality range.</summary>
        public const string Base = "base";

        /// <summary>
        /// At the base slope the top rung exceeded the ceiling; λ was raised as far as it goes while the
        /// top rung still reaches it — onto the cheapest measured sample at or above the ceiling — or,
        /// when even the bottom of its window lies above the ceiling, just far enough to pin it there.
        /// </summary>
        public const string Ceiling = "ceiling";

        /// <summary>At the base slope the top rung fell under the floor; λ was lowered until it clears it.</summary>
        public const string Floor = "floor";

        /// <summary>As <see cref="Floor"/>, but the top resolution never reaches the floor, so λ was lowered to its best sample.</summary>
        public const string Reachable = "reachable";
    }

    /// <summary>
    /// Which rule put a rung at its bitrate. Every rung is taken at its resolution's λ point; when
    /// that point lies outside the rung's admissible interval, the rung goes to the nearest end of
    /// the interval instead, named by the bound that set that end.
    /// </summary>
    internal static class Placements {
        /// <summary>The λ point lies inside the interval.</summary>
        public const string Lambda = "lambda";

        /// <summary>Raised to the bitrate where its resolution starts to be the best one.</summary>
        public const string Window = "window";

        /// <summary>Lowered to the crossover above which the next resolution up is the better one.</summary>
        public const string Cap = "cap";

        /// <summary>Lowered to ×<see cref="MinRungSpacing"/> below the rung above.</summary>
        public const string Spacing = "spacing";

        /// <summary>Raised to <see cref="BitrateFloorBps"/>.</summary>
        public const string Floor = "floor";

        /// <summary>Raised to the lowest rate whose predicted CAMBI stays within <see cref="MaxPredictedCambi"/>.</summary>
        public const string Cambi = "cambi";

        /// <summary>
        /// Not a resolution's λ point: inserted at the geometric mean of a gap wider than
        /// ×<see cref="MaxRungGap"/> between the rungs either side.
        /// </summary>
        public const string Gap = "gap";
    }

    /// <summary>What the CAMBI limit did to a rung it applies to.</summary>
    internal static class CambiLimitStatus {
        /// <summary>The rung's own placement already meets the limit.</summary>
        public const string Met = "met";

        /// <summary>The limit raised the rung — its placement is <see cref="Placements.Cambi"/>.</summary>
        public const string Binding = "binding";

        /// <summary>No rate inside the interval meets the limit; the rung stays where the other rules put it.</summary>
        public const string Unmet = "cambi-unmet";
    }

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

    /// <param name="points">This run's own grid — the one stored with the ladder.</param>
    /// <param name="defaultGrid">
    /// The default grid, pooled with <paramref name="points"/> when <see cref="LadderDerivationOptions.Pooled"/>
    /// is set. Read through tagged copies, so the default ladder's stored grid is left as it was.
    /// </param>
    public async Task<LadderDerivationResult> DeriveAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> points,
        LadderDerivationOptions options,
        IReadOnlyList<EncodeGridPoint>? defaultGrid = null,
        CancellationToken cancellationToken = default) {
        // Persisted with the points, so the stored grid reproduces exactly the decisions made here.
        foreach (var point in points) {
            point.CambiPenaltyWeight = options.CambiPenaltyWeight;
        }

        try {
            var candidates = options.Pooled && defaultGrid is { Count: > 0 }
                ? Pool(points, defaultGrid, options.CambiPenaltyWeight)
                : points;

            var plan = Plan(candidates, cambiLimit: options.CambiLimit);
            if (plan.Error != null) {
                return Fail(plan.Error);
            }

            MarkGlobalHull(plan.PooledHull, points);

            foreach (var rung in plan.Rungs) {
                _logger.LogInformation(
                    "{Name} {Label}: {Bitrate} kb/s by {Placement} rule{CambiLimit}, setting {Setting} — λ point {LambdaPoint} kb/s, interval [{Low}, {High}] kb/s, predicted harm. VMAF {Predicted:0.##}, CAMBI {Cambi:0.##}",
                    options.ProfileName,
                    rung.Hull.Label,
                    rung.BitrateBps / 1000,
                    rung.Placement,
                    rung.CambiLimit == CambiLimitStatus.Unmet ? " (cambi-unmet)" : "",
                    rung.Prediction.Setting ?? "own",
                    rung.LambdaPoint.BitrateBps / 1000,
                    Math.Round(rung.IntervalLowBps / 1000),
                    rung.IntervalHighBps is { } high ? Math.Round(high / 1000).ToString(CultureInfo.InvariantCulture) : "∞",
                    rung.Prediction.VmafHarmonicMean,
                    rung.Prediction.Cambi);
            }

            var (variants, derivedVariants) = BuildVariants(plan, candidates, options.Recipe.Tune);

            var profile = new TranscodeProfile {
                Name = options.ProfileName,
                Variants = variants,
                VideoCodec = TranscodeProfile.Default.VideoCodec,
                AudioCodec = TranscodeProfile.Default.AudioCodec,
                AudioBitrate = TranscodeProfile.Default.AudioBitrate,
                SegmentDurationSeconds = TranscodeProfile.Default.SegmentDurationSeconds,
                // Packaging must repeat the settings the grid was measured under: a pooled ladder
                // carries each rung's tune on the rung itself, every other ladder on the profile.
                Tune = options.Pooled ? null : options.Recipe.Tune,
                Decimate = options.Recipe.Decimate
            };

            var document = BuildDocument(plan, profile.Name, derivedVariants, options.CambiPenaltyWeight);
            document.Pooled = !ReferenceEquals(candidates, points);
            document.CambiLimit = options.CambiLimit == CambiLimitMode.Off ? null : options.CambiLimit.ToString();
            document.MaxPredictedCambi = options.CambiLimit == CambiLimitMode.Off ? null : MaxPredictedCambi;
            var sensitivity = options.CambiPenaltyWeight > 0 ? Sensitivity(candidates, options.CambiLimit) : null;

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
    internal static LadderPlan Plan(
        IReadOnlyList<EncodeGridPoint> points,
        double qualityFloor = QualityFloor,
        CambiLimitMode cambiLimit = CambiLimitMode.Off) {
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

        // λ is judged on the top rung as it ships: raised into its window, to the floor, and —
        // when the limit covers it — to the rate its predicted CAMBI allows.
        var topWindow = envelope.Windows[top.Height];
        var topLow = Math.Max(topWindow.LowBps, BitrateFloorBps);
        if (CambiLimitApplies(cambiLimit, top, isTopRung: true) &&
            CambiEdge(top, topLow, top.Points[^1].BitrateBps) is { } topEdge) {
            topLow = Math.Max(topLow, topEdge);
        }

        var (lambda, lambdaRule) = ChooseLambda(top, topLow);
        var dropped = new Dictionary<string, string>();
        var emptyWindows = new List<EnvelopeWindow>();
        var warnings = new List<string>();
        var rungs = new List<PlannedRung>();

        // Per setting: each setting's grid has its own lowest CRF.
        var lowestCrf = points
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0)
            .GroupBy(point => (point.Height, point.Setting))
            .ToDictionary(group => group.Key, group => group.Min(point => point.Crf));

        // Top rung first, so each rung's spacing bound comes from the final rung above it.
        long? above = null;
        string? aboveLabel = null;

        foreach (var hull in hulls) {
            if (!envelope.Windows.TryGetValue(hull.Height, out var window)) {
                dropped[hull.Label] = "never the best resolution at any bitrate above the quality floor";
                continue;
            }

            if (window.Fragmented) {
                warnings.Add($"{hull.Label} wins in more than one disjoint bitrate range; the highest one is used.");
            }

            var (low, high) = AdmissibleInterval(window, above, aboveLabel);
            var measuredTop = hull.Points[^1].BitrateBps;

            if (FallsShort(Math.Min(high.Bps, measuredTop), low.Bps)) {
                dropped[hull.Label] = low.Bps > measuredTop && high.Bps > measuredTop
                    ? $"its interval starts at {Mbps(low.Bps)} ({low.Describe}), above its highest grid sample at {Mbps(measuredTop)}"
                    : $"its admissible interval is empty: {low.Describe} at {Mbps(low.Bps)} lies above {high.Describe} at {Mbps(high.Bps)}";

                // The resolution would have room if its curve were sampled that far up.
                if (low.Bps > measuredTop && high.Bps > measuredTop) {
                    emptyWindows.Add(window with { LowBps = low.Bps });
                }

                continue;
            }

            // The CAMBI limit is one more lower edge of the interval. It never reaches past the
            // interval: when no rate inside it meets the limit, the other rules alone place the rung.
            string? cambiStatus = null;
            if (CambiLimitApplies(cambiLimit, hull, isTopRung: rungs.Count == 0)) {
                if (CambiEdge(hull, low.Bps, Math.Min(high.Bps, measuredTop)) is { } edge) {
                    cambiStatus = CambiLimitStatus.Met;
                    if (Exceeds(edge, low.Bps)) {
                        low = new Bound(edge, Placements.Cambi, $"predicted CAMBI ≤ {MaxPredictedCambi:0.#}");
                    }
                } else {
                    cambiStatus = CambiLimitStatus.Unmet;
                }
            }

            var lambdaPoint = Optimal(hull, lambda);
            var (target, placement) =
                FallsShort(lambdaPoint.BitrateBps, low.Bps) ? (low.Bps, low.Rule)
                : Exceeds(lambdaPoint.BitrateBps, high.Bps) ? (high.Bps, high.Rule)
                : (lambdaPoint.BitrateBps, Placements.Lambda);

            if (placement == Placements.Cambi) {
                cambiStatus = CambiLimitStatus.Binding;
            }

            var bitrate = ShipBps(target, low.Bps, high.Bps);
            var prediction = PredictAt(hull, bitrate);
            var slope = prediction.OnVertex ? LocalSlope(prediction.Curve, prediction.Vertex) : prediction.SegmentSlope;

            var atBoundary =
                placement == Placements.Lambda &&
                ReferenceEquals(lambdaPoint, hull.Points[^1]) &&
                lowestCrf.TryGetValue((hull.Height, lambdaPoint.Setting), out var minCrf) &&
                lambdaPoint.Crf == minCrf &&
                (slope == null || slope > lambda) &&
                !(ReferenceEquals(hull, top) && lambdaPoint.DecisionQuality >= TopRungCeiling);

            rungs.Add(new PlannedRung(
                hull,
                bitrate,
                placement,
                prediction,
                lambdaPoint,
                slope,
                atBoundary,
                low.Bps,
                double.IsInfinity(high.Bps) ? null : high.Bps,
                window,
                HullDeficit(pooledHull, bitrate, prediction.DecisionQuality),
                cambiStatus));

            above = bitrate;
            aboveLabel = hull.Label;
        }

        if (rungs.Count == 0) {
            return LadderPlan.Failed("No operating point survived selection");
        }

        FillGaps(rungs, hulls, envelope, pooledHull, warnings);
        warnings.AddRange(GapWarnings(rungs));

        return new LadderPlan(null, lambda, lambdaRule, hulls, rungs, envelope, pooledHull, dropped, emptyWindows, warnings);
    }

    /// <summary>
    /// Closes every gap wider than ×<see cref="MaxRungGap"/> between adjacent rungs: a rung goes in
    /// at the geometric-mean bitrate, at the resolution best on the hull there and the setting whose
    /// own curve does better for it, until no adjacent pair is further apart.
    /// </summary>
    /// <remarks>
    /// One rung per resolution leaves holes wherever a resolution's window is narrow or lies under
    /// the floor — Tatami's animation ladder went from 1.57 to 0.16 Mb/s in one step, so on 3G every
    /// ABR rule sat on the bottom rung. An inserted rung may repeat a resolution the ladder already
    /// has, at a different bitrate; that is how a real ladder covers a wide window. The insert is read
    /// off the same per-setting curves as every other rung, so its prediction is as measured as theirs.
    /// </remarks>
    private static void FillGaps(
        List<PlannedRung> rungs,
        List<ResolutionHull> hulls,
        Envelope envelope,
        List<EncodeGridPoint> pooledHull,
        List<string> warnings) {
        for (var guard = 0; guard < 32; guard++) {
            rungs.Sort((a, b) => b.BitrateBps.CompareTo(a.BitrateBps));

            var gapAt = -1;
            for (var i = 0; i + 1 < rungs.Count; i++) {
                if (rungs[i].BitrateBps > rungs[i + 1].BitrateBps * MaxRungGap * (1 + RateTolerance)) {
                    gapAt = i;
                    break;
                }
            }

            if (gapAt < 0) {
                return;
            }

            var (upper, lower) = (rungs[gapAt], rungs[gapAt + 1]);
            var target = Math.Sqrt((double)upper.BitrateBps * lower.BitrateBps);
            var bitrate = ShipBps(target, lower.BitrateBps * 1.0001, upper.BitrateBps * 0.9999);

            // The resolution is the one best on the hull there — the envelope's choice, on the same
            // pooled hulls the windows come from; only a resolution sampled across this rate can be
            // read there. The setting is then whichever of its own curves does better at the rate.
            // Choosing resolution and setting together off the per-setting curves would disagree with
            // the windows: a pooled hull segment that bridges two settings lies above both curves.
            var hull = hulls
                .Where(candidate =>
                    !FallsShort(bitrate, candidate.Points[0].BitrateBps) &&
                    !Exceeds(bitrate, candidate.Points[^1].BitrateBps))
                .MaxBy(candidate => QualityAt(candidate.Points, Math.Log2(bitrate)));

            if (hull == null) {
                warnings.Add(
                    $"Gap between {upper.Hull.Label} and {lower.Hull.Label} left open: no resolution was sampled at {Mbps(bitrate)}.");
                return;
            }

            var prediction = PredictAt(hull, bitrate);
            var window = envelope.Windows.TryGetValue(hull.Height, out var own)
                ? own
                : new EnvelopeWindow(hull.Height, hull.Label, lower.BitrateBps, upper.BitrateBps, false);

            rungs.Add(new PlannedRung(
                hull,
                bitrate,
                Placements.Gap,
                prediction,
                prediction.Vertex,
                prediction.OnVertex ? LocalSlope(prediction.Curve, prediction.Vertex) : prediction.SegmentSlope,
                false,
                lower.BitrateBps,
                upper.BitrateBps,
                window,
                HullDeficit(pooledHull, bitrate, prediction.DecisionQuality)));
        }

        warnings.Add("Gap filling stopped after 32 inserts.");
    }

    /// <summary>One end of a rung's admissible interval and the rule that set it.</summary>
    private readonly record struct Bound(double Bps, string Rule, string Describe);

    /// <summary>
    /// The bitrates a rung may take: no lower than where its resolution starts to win or the floor,
    /// no higher than where the next resolution up takes over or ×<see cref="MinRungSpacing"/>
    /// below the rung above, whichever bound is tighter on each side.
    /// </summary>
    private static (Bound Low, Bound High) AdmissibleInterval(EnvelopeWindow window, long? above, string? aboveLabel) {
        var low = window.LowBps >= BitrateFloorBps
            ? new Bound(window.LowBps, Placements.Window, $"the bottom of its {window.Label} window")
            : new Bound(BitrateFloorBps, Placements.Floor, "the bitrate floor");

        var high = new Bound(window.HighBps, Placements.Cap, "the crossover above it");
        if (above is { } upper && upper / MinRungSpacing < high.Bps) {
            high = new Bound(upper / MinRungSpacing, Placements.Spacing, $"×{MinRungSpacing} below {aboveLabel}");
        }

        return (low, high);
    }

    /// <summary>
    /// <paramref name="bps"/> rounded to <see cref="RoundToKbps"/> and kept inside the interval —
    /// or to whole kb/s when the interval is too narrow to hold a multiple of the coarser step, so
    /// rounding never pushes a rung past its own bounds.
    /// </summary>
    private static long ShipBps(double bps, double low, double high) {
        foreach (var step in new[] { RoundToKbps * 1000.0, 1000.0 }) {
            var lowest = Math.Ceiling(low * (1 - RateTolerance) / step) * step;
            var highest = Math.Floor(high * (1 + RateTolerance) / step) * step;
            if (lowest <= highest) {
                return (long)Math.Clamp(Math.Round(bps / step) * step, lowest, highest);
            }
        }

        // Narrower than 1 kb/s: as good as a single point.
        return (long)Math.Round(bps);
    }

    private static bool CambiLimitApplies(CambiLimitMode mode, ResolutionHull hull, bool isTopRung) => mode switch {
        CambiLimitMode.TopRung => isTopRung,
        CambiLimitMode.AtLeast720p => hull.Height >= 720,
        _ => false
    };

    /// <summary>
    /// The lowest rate in [<paramref name="lowBps"/>, <paramref name="highBps"/>] from which the
    /// predicted CAMBI stays within <see cref="MaxPredictedCambi"/> all the way up to
    /// <paramref name="highBps"/> — or null when it is already over the limit at the top, so no
    /// rate inside the interval meets it.
    /// </summary>
    /// <remarks>
    /// Read off the same per-setting curves the rung's prediction comes from, so the setting that
    /// wins at each rate is the one whose CAMBI counts. Banding is not monotonic in rate at the low
    /// end, which is why the edge is where it stays within the limit, not merely where it first dips.
    /// </remarks>
    private static double? CambiEdge(ResolutionHull hull, double lowBps, double highBps) {
        const int steps = 400;

        bool Meets(double bps) => PredictAt(hull, bps).Cambi is { } cambi && cambi <= MaxPredictedCambi;

        if (!Meets(highBps)) {
            return null;
        }

        var ratio = highBps / lowBps;
        var met = highBps;
        for (var i = steps - 1; i >= 0; i--) {
            var bps = lowBps * Math.Pow(ratio, (double)i / steps);
            if (!Meets(bps)) {
                // Between the last rate that failed and the first that held: bisect for the edge.
                var (fail, hold) = (bps, met);
                for (var j = 0; j < 40; j++) {
                    var mid = Math.Sqrt(fail * hold);
                    if (Meets(mid)) {
                        hold = mid;
                    } else {
                        fail = mid;
                    }
                }

                return hold;
            }

            met = bps;
        }

        return lowBps;
    }

    private static string Mbps(double bps) =>
        string.Create(CultureInfo.InvariantCulture, $"{bps / 1_000_000.0:0.###} Mb/s");

    private static bool IsUsable(EncodeGridPoint point, double qualityFloor) =>
        string.IsNullOrEmpty(point.Error) &&
        point.BitrateBps > 0 &&
        point.RawQuality >= qualityFloor &&
        point.DecisionQuality > 0;

    private static bool Exceeds(double bps, double bound) => bps > bound * (1 + RateTolerance);

    private static bool FallsShort(double bps, double bound) => bps < bound * (1 - RateTolerance);

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
                UpperHull(group.OrderBy(point => point.BitrateBps).ToList()),
                group
                    .GroupBy(point => point.Setting ?? "")
                    .ToDictionary(
                        setting => setting.Key,
                        setting => UpperHull(setting.OrderBy(point => point.BitrateBps).ToList()))))
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
    /// Flags every point of this run's own grid that lies on the pooled convex hull, so the
    /// analysis UI can draw the hull through the scatter. Matched by setting, resolution and CRF,
    /// since a pooled ladder plans on copies.
    /// </summary>
    private static void MarkGlobalHull(List<EncodeGridPoint> pooledHull, IReadOnlyList<EncodeGridPoint> own) {
        var onHull = pooledHull
            .Select(point => (point.Setting ?? EncodeSettings.Tuned, point.Height, point.Crf))
            .ToHashSet();

        foreach (var point in own) {
            point.OnHull = onHull.Contains((point.Setting ?? EncodeSettings.Tuned, point.Height, point.Crf));
        }
    }

    /// <summary>
    /// One candidate set from the tuned grid and the default grid: every sample copied, tagged with
    /// the setting it was encoded under and scored at the same CAMBI weight, so the two settings
    /// compete on one decision quality. Hulls, windows and λ are then built from the pool.
    /// </summary>
    /// <remarks>
    /// A sample in the tuned grid already tagged <see cref="EncodeSettings.Default"/> was taken under
    /// the default setting while that grid refined the pooled ladder, and keeps its tag.
    /// </remarks>
    internal static List<EncodeGridPoint> Pool(
        IReadOnlyList<EncodeGridPoint> tuned,
        IReadOnlyList<EncodeGridPoint> defaults,
        double weight) =>
        tuned.Select(point => point.Pooled(point.Setting ?? EncodeSettings.Tuned, weight))
            .Concat(defaults.Select(point => point.Pooled(EncodeSettings.Default, weight)))
            .ToList();

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
    private static double HullDeficit(List<EncodeGridPoint> pooledHull, double bitrateBps, double decisionQuality) {
        var hullQuality = QualityAt(pooledHull, Math.Log2(bitrateBps));
        return double.IsNegativeInfinity(hullQuality) ? 0 : Math.Max(0, hullQuality - decisionQuality);
    }

    /// <summary>
    /// What a resolution is predicted to deliver at a bitrate, under the setting that does better
    /// there: each setting's own curve read linearly in log-rate between the two of its samples
    /// either side, and the higher decision quality taken. Clamped to the sampled range, which the
    /// admissible interval keeps every rung inside.
    /// </summary>
    /// <remarks>
    /// With a single setting its curve is the hull itself, the same curve the λ point and the
    /// envelope are taken from. With two, a rung is never read off a pooled hull segment that joins
    /// a sample of one setting to a sample of the other: such a segment describes no encode anyone
    /// would make, while each setting's own curve describes the encode that ships.
    /// </remarks>
    internal static RungPrediction PredictAt(ResolutionHull hull, double bitrateBps) {
        if (hull.Curves.Count <= 1) {
            return Interpolate(hull.Points, bitrateBps, hull.Curves.Keys.FirstOrDefault());
        }

        var covering = hull.Curves
            .Where(curve =>
                !FallsShort(bitrateBps, curve.Value[0].BitrateBps) &&
                !Exceeds(bitrateBps, curve.Value[^1].BitrateBps))
            .ToList();

        return (covering.Count > 0 ? covering : hull.Curves.ToList())
            .Select(curve => Interpolate(curve.Value, bitrateBps, curve.Key))
            .MaxBy(prediction => prediction.DecisionQuality)!;
    }

    private static RungPrediction Interpolate(List<EncodeGridPoint> points, double bitrateBps, string? setting) {
        var tag = string.IsNullOrEmpty(setting) ? null : setting;
        if (bitrateBps <= points[0].BitrateBps) {
            return new RungPrediction(points, points[0], points[0], 0, tag);
        }

        for (var i = 0; i < points.Count - 1; i++) {
            if (bitrateBps > points[i + 1].BitrateBps) {
                continue;
            }

            var t = (Math.Log2(bitrateBps) - LogRate(points[i])) / (LogRate(points[i + 1]) - LogRate(points[i]));
            return new RungPrediction(points, points[i], points[i + 1], t, tag);
        }

        return new RungPrediction(points, points[^1], points[^1], 0, tag);
    }

    // ---- Lagrangian selection ----------------------------------------------------------------

    /// <summary>
    /// Picks the Lagrange multiplier λ: the base slope, pulled back only far enough to keep the top
    /// rung inside its quality range. Returns which of those cases applied, so a λ other than the
    /// base can be traced to the bound that moved it.
    /// </summary>
    /// <remarks>
    /// For a given λ, maximizing Q − λ·log₂(R) on a concave hull lands on the vertex where the
    /// local slope crosses λ, so one λ across every resolution makes all rungs share the same
    /// quality-per-bit trade-off. That equal-slope condition is the actual optimality criterion
    /// behind convex-hull ladder design: picking each rung at a fixed target score instead spends
    /// bits unevenly, over-paying wherever that resolution's curve happens to be flat.
    /// </remarks>
    /// <param name="low">The lower edge of the top rung's interval. The top rung that ships is its λ
    /// point raised to that edge when it falls below — the bottom of its window, the floor, or the
    /// CAMBI limit — so λ is judged on that rung; judging it on the unclamped point would let the two
    /// disagree. Because the edge is applied first, the CAMBI limit takes precedence over the
    /// ceiling: λ can pin the top rung at the edge but never pull it under.</param>
    internal static (double Lambda, string Rule) ChooseLambda(ResolutionHull top, double low) {
        var reachable = top.Points.Max(point => point.DecisionQuality);
        var lambda = LambdaBaseSlope;

        // Larger λ prices bits higher, so it selects a cheaper, lower-quality rung.
        if (TopQuality(lambda) > TopRungCeiling) {
            // Pinned to the bottom of its window, the top rung may stay above the ceiling at any λ.
            // λ is then raised only as far as it takes to pin it there: beyond that it would squeeze
            // the lower rungs without moving the top one.
            var pinned = TopQuality(lambda * 64);
            return pinned >= TopRungCeiling
                ? (Smallest(candidate => TopQuality(candidate) <= pinned + 1e-9, lambda, lambda * 64), LambdaRules.Ceiling)
                : (Largest(candidate => TopQuality(candidate) >= TopRungCeiling, lambda, lambda * 64), LambdaRules.Ceiling);
        }

        if (TopQuality(lambda) < Math.Min(TopRungFloor, reachable)) {
            return reachable < TopRungFloor
                ? (Largest(candidate => TopQuality(candidate) >= reachable, lambda / 64, lambda), LambdaRules.Reachable)
                : (Largest(candidate => TopQuality(candidate) >= TopRungFloor, lambda / 64, lambda), LambdaRules.Floor);
        }

        return (lambda, LambdaRules.Base);

        double TopQuality(double candidate) =>
            PredictAt(top, Math.Max(Optimal(top, candidate).BitrateBps, low)).DecisionQuality;

        // The top rung's quality falls as λ rises, so both predicates flip once over the range.
        static double Largest(Func<double, bool> holds, double low, double high) {
            for (var i = 0; i < 60; i++) {
                var mid = (low + high) / 2;
                if (holds(mid)) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            return low;
        }

        static double Smallest(Func<double, bool> holds, double low, double high) {
            for (var i = 0; i < 60; i++) {
                var mid = (low + high) / 2;
                if (holds(mid)) {
                    high = mid;
                } else {
                    low = mid;
                }
            }

            return high;
        }
    }

    /// <summary>The hull vertex maximizing Q − λ·log₂(R).</summary>
    private static EncodeGridPoint Optimal(ResolutionHull hull, double lambda) => hull.Points
        .OrderByDescending(point => point.DecisionQuality - lambda * LogRate(point))
        .ThenBy(point => point.BitrateBps)
        .First();

    private static IEnumerable<string> GapWarnings(List<PlannedRung> rungs) {
        for (var i = 1; i < rungs.Count; i++) {
            var upper = rungs[i - 1];
            var lower = rungs[i];
            var ratio = (double)upper.BitrateBps / lower.BitrateBps;
            var qualityGap = upper.Prediction.RawQuality - lower.Prediction.RawQuality;

            if (ratio > GapRatioWarning || qualityGap > GapQualityWarning) {
                yield return string.Create(
                    CultureInfo.InvariantCulture,
                    $"Gap between {rungs[i - 1].Hull.Label} and {rungs[i].Hull.Label}: ×{ratio:0.0} in bitrate, {qualityGap:0.#} VMAF. One rung per resolution cannot fill it.");
            }
        }
    }

    private static double? LocalSlope(IReadOnlyList<EncodeGridPoint> curve, EncodeGridPoint point) {
        var index = curve.ToList().IndexOf(point);
        if (index < 0 || curve.Count < 2) {
            return null;
        }

        var (a, b) = index == 0
            ? (curve[0], curve[1])
            : (curve[index - 1], curve[index]);

        var run = LogRate(b) - LogRate(a);
        return run > 1e-9 ? (b.DecisionQuality - a.DecisionQuality) / run : null;
    }

    // ---- Output ------------------------------------------------------------------------------

    /// <param name="ownTune">The tune of the grid being derived from — what every rung not taken under the default setting is encoded with.</param>
    private static (List<TranscodeVariant> Variants, List<DerivedLadderVariant> Derived) BuildVariants(
        LadderPlan plan,
        IReadOnlyList<EncodeGridPoint> allPoints,
        string? ownTune = null) {
        var variants = new List<TranscodeVariant>();
        var derived = new List<DerivedLadderVariant>();

        // A label names a rung's files, playlist and scores, so it must be unique. A resolution's
        // λ-placed rung keeps the plain label; a gap rung repeating that resolution is named by its
        // bitrate as well.
        var labels = plan.Rungs
            .OrderBy(rung => rung.Placement == Placements.Gap)
            .ThenByDescending(rung => rung.BitrateBps)
            .Aggregate(new Dictionary<PlannedRung, string>(), (assigned, rung) => {
                var plain = rung.Hull.Label;
                assigned[rung] = assigned.ContainsValue(plain) ? $"{plain}-{rung.BitrateBps / 1000}k" : plain;
                return assigned;
            });

        foreach (var rung in plan.Rungs.OrderByDescending(item => item.BitrateBps)) {
            var bitrate = $"{rung.BitrateBps / 1000}k";
            var resolution = $"{rung.Hull.Width}:{rung.Hull.Height}";
            var prediction = rung.Prediction;
            var label = labels[rung];

            // Each rung is encoded with the setting its prediction was read from.
            var tune = prediction.Setting == EncodeSettings.Default ? null : ownTune;
            variants.Add(new TranscodeVariant(resolution, bitrate, label, tune));
            derived.Add(new DerivedLadderVariant {
                Label = label,
                Resolution = resolution,
                Bitrate = bitrate,
                BitrateBps = rung.BitrateBps,
                PredictedVmaf = Round(prediction.VmafMean),
                PredictedVmafHarmonic = Round(prediction.VmafHarmonicMean),
                PredictedVmafMin = Round(prediction.VmafMin),
                PredictedCambi = Round(prediction.Cambi),
                Setting = prediction.Setting,
                CambiLimit = rung.CambiLimit,
                Crf = prediction.OnVertex ? prediction.Vertex.Crf : null,
                InterpolatedBetweenCrf = prediction.OnVertex ? null : [prediction.Lower.Crf, prediction.Upper.Crf],
                HullSlope = rung.Slope,
                OnEnvelope = true,
                HullDeficit = Math.Round(rung.HullDeficit, 3),
                Placement = rung.Placement,
                LambdaPointBps = rung.LambdaPoint.BitrateBps,
                IntervalLowBps = (long)Math.Round(rung.IntervalLowBps),
                IntervalHighBps = rung.IntervalHighBps is { } high ? (long)Math.Round(high) : null,
                AtGridBoundary = rung.AtGridBoundary
            });
        }

        static double? Round(double? value) => value is { } v ? Math.Round(v, 3) : null;

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

        // Highest bitrate first. With one rung per resolution that is also highest resolution first;
        // with a repeated resolution only bitrate orders the ladder.
        return (
            variants.OrderByDescending(variant => TranscodeProfile.ParseBitrateKbps(variant.Bitrate)).ToList(),
            derived.OrderByDescending(variant => variant.BitrateBps).ToList()
        );
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
            LambdaRule = plan.LambdaRule,
            LambdaBase = LambdaBaseSlope,
            TopRungFloor = TopRungFloor,
            TopRungCeiling = TopRungCeiling,
            BitrateFloorBps = BitrateFloorBps,
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
    internal static List<LadderSensitivityEntry> Sensitivity(
        IReadOnlyList<EncodeGridPoint> points,
        CambiLimitMode cambiLimit = CambiLimitMode.Off) {
        var entries = new List<LadderSensitivityEntry>();

        foreach (var weight in SensitivityWeights) {
            var weighted = points.Select(point => point.WithPenaltyWeight(weight)).ToList();
            var plan = Plan(weighted, cambiLimit: cambiLimit);
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
                    ? $"{variant.Bitrate} — {DescribePlacement(variant.Placement)} " +
                      $"({(variant.Setting != null ? $"{variant.Setting} setting, " : "")}" +
                      $"{(variant.Crf is { } crf ? $"CRF {crf}" : $"between CRF {variant.InterpolatedBetweenCrf?[0]} and {variant.InterpolatedBetweenCrf?[1]}")}, " +
                      $"pred. harm. VMAF {Format(variant.PredictedVmafHarmonic)}" +
                      $"{(variant.PredictedCambi != null ? $", CAMBI {Format(variant.PredictedCambi)}" : "")})" +
                      (variant.AtGridBoundary == true ? ", at grid edge" : "") +
                      (variant.CambiLimit == CambiLimitStatus.Unmet ? $", CAMBI limit {MaxPredictedCambi:0.#} unmet inside its interval" : "")
                    : variant.Fallback == true
                        ? $"{variant.Bitrate} (default — no measurement)"
                        : variant.Bitrate))
            .ToList();

        children.Insert(0, Leaf($"{key}.lambda", "Hull slope (λ)", Format(document.Lambda)));
        children.Insert(1, Leaf($"{key}.lambdaRule", "λ rule", DescribeLambdaRule(document)));
        children.Insert(2, Leaf($"{key}.floor", "Quality floor (harm. VMAF)", Format(document.QualityFloor)));

        if (options.CambiPenaltyWeight > 0) {
            children.Insert(3, Leaf(
                $"{key}.cambiPenalty",
                "CAMBI penalty",
                $"{Format(options.CambiPenaltyWeight)} VMAF per CAMBI unit"));
        }

        if (options.CambiLimit != CambiLimitMode.Off) {
            children.Insert(options.CambiPenaltyWeight > 0 ? 4 : 3, Leaf(
                $"{key}.cambiLimit",
                "CAMBI limit",
                $"predicted CAMBI ≤ {MaxPredictedCambi:0.#} on " +
                (options.CambiLimit == CambiLimitMode.TopRung ? "the top rung" : "every rung at 720p and above")));
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

        var label = options.Pooled
            ? $"Animation ladder (default + {options.Recipe.Tune} pooled)"
            : options.Recipe.Tune == null
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

    internal static string DescribePlacement(string? placement) => placement switch {
        Placements.Window => "raised to the bottom of its window",
        Placements.Cap => "lowered to the crossover above",
        Placements.Spacing => $"lowered to ×{MinRungSpacing} below the rung above",
        Placements.Floor => "raised to the bitrate floor",
        Placements.Cambi => $"raised until its predicted CAMBI stays within {MaxPredictedCambi:0.#}",
        Placements.Gap => $"inserted at the geometric mean of a gap wider than ×{MaxRungGap:0.#}",
        _ => "at the λ point"
    };

    private static string DescribeLambdaRule(DerivedLadderDocument document) {
        var range = string.Create(
            CultureInfo.InvariantCulture,
            $"harm. VMAF {document.TopRungFloor:0.##}–{document.TopRungCeiling:0.##}");
        var start = string.Create(CultureInfo.InvariantCulture, $"base slope {document.LambdaBase:0.##}");

        return document.LambdaRule switch {
            LambdaRules.Ceiling => $"raised from the {start}: the top rung there exceeded {range}, so it moves to the cheapest sample still reaching the ceiling",
            LambdaRules.Floor => $"lowered from the {start}: the top rung there fell short of {range}",
            LambdaRules.Reachable => $"lowered from the {start} to the top resolution's best sample, which stays under {range}",
            _ => $"{start}: the top rung already lies inside {range}"
        };
    }

    private static LadderDerivationResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };

    /// <summary>One resolution's rate-quality curve, reduced to its upper convex hull.</summary>
    /// <param name="Points">The hull over every sample, whatever its setting — what λ and the windows are taken from.</param>
    /// <param name="Curves">The upper hull of each setting's samples alone, keyed by setting ("" when untagged).</param>
    internal sealed record ResolutionHull(
        int Height,
        string Label,
        int Width,
        List<EncodeGridPoint> Points,
        IReadOnlyDictionary<string, List<EncodeGridPoint>> Curves);

    /// <summary>The bitrate range in which one resolution delivers the highest quality.</summary>
    internal sealed record EnvelopeWindow(int Height, string Label, double LowBps, double HighBps, bool Fragmented);

    internal sealed record Crossover(string Key, int UpperHeight, int LowerHeight, long BitrateBps, bool Extrapolated);

    internal sealed record Envelope(Dictionary<int, EnvelopeWindow> Windows, List<Crossover> Crossovers);

    /// <summary>
    /// A chosen rung. Grid points are referenced, never written to, so the measured RD data stays
    /// exactly as it was measured.
    /// </summary>
    /// <param name="BitrateBps">The rate it ships at, rounded to <see cref="RoundToKbps"/>.</param>
    /// <param name="Placement">The rule that put it there — see <see cref="Placements"/>.</param>
    /// <param name="Prediction">Its quality read off the hull at <paramref name="BitrateBps"/>.</param>
    /// <param name="LambdaPoint">Its resolution's λ point, where it sits unless clamped.</param>
    /// <param name="IntervalHighBps">Upper end of its admissible interval; null for the top rung.</param>
    /// <param name="CambiLimit">What the CAMBI limit did to it (see <see cref="CambiLimitStatus"/>); null when the limit does not cover it.</param>
    internal sealed record PlannedRung(
        ResolutionHull Hull,
        long BitrateBps,
        string Placement,
        RungPrediction Prediction,
        EncodeGridPoint LambdaPoint,
        double? Slope,
        bool AtGridBoundary,
        double IntervalLowBps,
        double? IntervalHighBps,
        EnvelopeWindow Window,
        double HullDeficit,
        string? CambiLimit = null) {
        /// <summary>The grid sample nearest the shipped rate.</summary>
        public EncodeGridPoint Anchor => Prediction.Vertex;
    }

    /// <summary>
    /// Quality at a bitrate between two neighbouring vertices of one setting's curve,
    /// <paramref name="T"/> of the way from <paramref name="Lower"/> to <paramref name="Upper"/> in
    /// log-rate.
    /// </summary>
    /// <param name="Curve">The curve read — one setting's samples only.</param>
    /// <param name="Setting">That setting, or null when the ladder has only one.</param>
    internal sealed record RungPrediction(
        IReadOnlyList<EncodeGridPoint> Curve,
        EncodeGridPoint Lower,
        EncodeGridPoint Upper,
        double T,
        string? Setting = null) {
        private const double VertexTolerance = 1e-6;

        /// <summary>True when the rate is a grid sample's own, so no interpolation was needed.</summary>
        public bool OnVertex => ReferenceEquals(Lower, Upper) || T < VertexTolerance || T > 1 - VertexTolerance;

        /// <summary>The nearer of the two samples — the rung's own sample when <see cref="OnVertex"/>.</summary>
        public EncodeGridPoint Vertex => T < 0.5 ? Lower : Upper;

        public double DecisionQuality => Mix(Lower.DecisionQuality, Upper.DecisionQuality);
        public double RawQuality => Mix(Lower.RawQuality, Upper.RawQuality);
        public double VmafMean => Mix(Lower.VmafMean, Upper.VmafMean);

        public double? VmafHarmonicMean =>
            Lower.VmafHarmonicMean is { } a && Upper.VmafHarmonicMean is { } b ? Mix(a, b) : null;

        public double? VmafMin => Lower.VmafMin is { } a && Upper.VmafMin is { } b ? Mix(a, b) : null;

        public double? Cambi => Lower.Cambi is { } a && Upper.Cambi is { } b ? Mix(a, b) : null;

        /// <summary>Slope of the hull segment the rate falls on, in decision quality per doubling.</summary>
        public double? SegmentSlope {
            get {
                var run = LogRate(Upper) - LogRate(Lower);
                return run > 1e-9 ? (Upper.DecisionQuality - Lower.DecisionQuality) / run : null;
            }
        }

        private double Mix(double a, double b) => OnVertex ? (T < 0.5 ? a : b) : a + (b - a) * T;
    }

    internal sealed record LadderPlan(
        string? Error,
        double Lambda,
        string LambdaRule,
        List<ResolutionHull> Hulls,
        // Ordered top rung first.
        List<PlannedRung> Rungs,
        Envelope Envelope,
        List<EncodeGridPoint> PooledHull,
        Dictionary<string, string> Dropped,
        List<EnvelopeWindow> EmptyWindows,
        List<string> Warnings) {
        internal static LadderPlan Failed(string error) =>
            new(error, 0, LambdaRules.Base, [], [], new Envelope(new Dictionary<int, EnvelopeWindow>(), []), [], new Dictionary<string, string>(), [], []);
    }

    private sealed class Run {
        public int Height { get; init; }
        public double Start { get; init; }
        public double End { get; set; }
    }
}
