using System.Text.Json;
using System.Text.Json.Serialization;

namespace WebWVideoStreamingAPI.Analysis;

public static class AnalysisSchema {
    /// <summary>Version echoed to the frontend on every analysis response.</summary>
    public const int Version = 6;

    /// <summary>
    /// How tree and series documents are stored in <c>AnalysisReport</c> and returned to the
    /// frontend. One instance, so stored JSON and served JSON can never drift.
    /// </summary>
    public static readonly JsonSerializerOptions Json = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };
}

public enum AnalysisSectionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    NotImplemented
}

/// <summary>
/// Serializes enums as camelCase strings. Applied per-property because the analysis tree is also
/// serialized by ASP.NET's default options, which have no enum converter registered.
/// </summary>
public sealed class CamelCaseEnumConverter : JsonStringEnumConverter {
    public CamelCaseEnumConverter() : base(JsonNamingPolicy.CamelCase) {
    }
}

public sealed class AnalysisTreeNodeMeta {
    [JsonPropertyName("source")]
    public string? Source { get; set; }

    [JsonPropertyName("status")]
    [JsonConverter(typeof(CamelCaseEnumConverter))]
    public AnalysisSectionStatus Status { get; set; } = AnalysisSectionStatus.Pending;

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("kind")]
    public string? Kind { get; set; }
}

public sealed class AnalysisTreeNode {
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("label")]
    public string Label { get; set; } = null!;

    [JsonPropertyName("value")]
    public string? Value { get; set; }

    [JsonPropertyName("meta")]
    public AnalysisTreeNodeMeta? Meta { get; set; }

    [JsonPropertyName("children")]
    public List<AnalysisTreeNode>? Children { get; set; }
}

public sealed class AnalysisTreeDocument {
    [JsonPropertyName("id")]
    public string Id { get; set; } = "root";

    [JsonPropertyName("label")]
    public string Label { get; set; } = "Source analysis";

    [JsonPropertyName("children")]
    public List<AnalysisTreeNode> Children { get; set; } = [];
}

public sealed class SitiSeriesData {
    [JsonPropertyName("si")]
    public List<double> Si { get; set; } = [];

    [JsonPropertyName("ti")]
    public List<double> Ti { get; set; } = [];

    [JsonPropertyName("timeSec")]
    public List<double>? TimeSec { get; set; }
}

public sealed class FormatSitiSeriesDocument {
    [JsonPropertyName("hls")]
    public Dictionary<string, SitiSeriesData>? Hls { get; set; }

    [JsonPropertyName("dash")]
    public Dictionary<string, SitiSeriesData>? Dash { get; set; }
}

/// <summary>
/// Aggregated VMAF statistics for one ladder rung — RD-curve coordinates for encode-grid work.
/// </summary>
public sealed class VmafSummary {
    [JsonPropertyName("mean")]
    public double Mean { get; set; }

    [JsonPropertyName("harmonicMean")]
    public double HarmonicMean { get; set; }

    [JsonPropertyName("min")]
    public double Min { get; set; }

    [JsonPropertyName("max")]
    public double Max { get; set; }

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("width")]
    public int? Width { get; set; }

    [JsonPropertyName("height")]
    public int? Height { get; set; }

    /// <summary>Bitrate actually measured on the scored video stream.</summary>
    [JsonPropertyName("bitrateBps")]
    public long? BitrateBps { get; set; }

    /// <summary>
    /// Bitrate the ladder rung was asked to hit, kept alongside the measured one. x264 does not
    /// land exactly on its target, so rate-quality comparisons must use <see cref="BitrateBps"/>.
    /// </summary>
    [JsonPropertyName("targetBitrateBps")]
    public long? TargetBitrateBps { get; set; }

    /// <summary>
    /// Mean CAMBI banding score of the distorted video. Higher is worse; a clean source sits near
    /// zero. Unlike VMAF this is a no-reference measure — it reports the banding present in the
    /// distorted frames rather than the difference from the reference.
    /// </summary>
    [JsonPropertyName("cambi")]
    public double? Cambi { get; set; }

    [JsonPropertyName("cambiMax")]
    public double? CambiMax { get; set; }
}

public sealed class VmafSeriesData {
    [JsonPropertyName("scores")]
    public List<double> Scores { get; set; } = [];

    [JsonPropertyName("timeSec")]
    public List<double>? TimeSec { get; set; }

    /// <summary>Pooled statistics of the primary model — the one <see cref="Scores"/> belongs to.</summary>
    [JsonPropertyName("summary")]
    public VmafSummary Summary { get; set; } = new();

    /// <summary>
    /// Pooled statistics per VMAF model, keyed by the <c>name=</c> given to libvmaf. libvmaf scores
    /// every requested model in a single pass, so the secondary model (NEG) costs nothing extra;
    /// only the primary model's per-frame series is kept, which is all a model comparison needs.
    /// </summary>
    [JsonPropertyName("summaryByModel")]
    public Dictionary<string, VmafSummary>? SummaryByModel { get; set; }
}

public sealed class FormatVmafSeriesDocument {
    [JsonPropertyName("hls")]
    public Dictionary<string, VmafSeriesData>? Hls { get; set; }

    [JsonPropertyName("dash")]
    public Dictionary<string, VmafSeriesData>? Dash { get; set; }
}

/// <summary>
/// One resolution×CRF encode-grid sample — an RD point for convex-hull / crossover derivation.
/// </summary>
public sealed class EncodeGridPoint {
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("width")]
    public int Width { get; set; }

    [JsonPropertyName("height")]
    public int Height { get; set; }

    [JsonPropertyName("crf")]
    public int Crf { get; set; }

    [JsonPropertyName("bitrateBps")]
    public long BitrateBps { get; set; }

    [JsonPropertyName("vmafMean")]
    public double VmafMean { get; set; }

    [JsonPropertyName("vmafHarmonicMean")]
    public double? VmafHarmonicMean { get; set; }

    [JsonPropertyName("vmafMin")]
    public double? VmafMin { get; set; }

    /// <summary>Mean under the NEG model, scored in the same libvmaf pass.</summary>
    [JsonPropertyName("vmafNegMean")]
    public double? VmafNegMean { get; set; }

    [JsonPropertyName("vmafNegHarmonicMean")]
    public double? VmafNegHarmonicMean { get; set; }

    /// <summary>Mean CAMBI banding score of this sample. Higher is worse.</summary>
    [JsonPropertyName("cambi")]
    public double? Cambi { get; set; }

    /// <summary>True when this point survives onto the global convex hull across all resolutions.</summary>
    [JsonPropertyName("onHull")]
    public bool OnHull { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    /// <summary>Wall time spent encoding and scoring this sample — what the time estimate is fitted to.</summary>
    [JsonPropertyName("elapsedMs")]
    public long? ElapsedMs { get; set; }

    /// <summary>
    /// Weight applied to <see cref="Cambi"/> when scoring this point, in VMAF points per unit of
    /// CAMBI. Zero for the generic ladders; the animation ladder sets it so that banding, which
    /// VMAF barely notices but which is the dominant artifact on flat cel-shaded areas, actually
    /// costs a candidate something.
    /// </summary>
    /// <remarks>
    /// Persisted rather than implied, so the stored grid reproduces the exact decisions it drove —
    /// without it the saved points could only be re-ranked on VMAF alone.
    /// </remarks>
    [JsonPropertyName("cambiPenaltyWeight")]
    public double CambiPenaltyWeight { get; set; }

    /// <summary>
    /// The statistic ladder decisions are made on. Harmonic mean penalizes brief quality dips far
    /// more than the arithmetic mean, which is why it, and not the mean, drives rung selection.
    /// </summary>
    /// <remarks>
    /// CAMBI enters as a penalty rather than a threshold on purpose. Measured across CRF on real
    /// animation it is not monotonic: banding rises as quantization coarsens, peaks, then falls
    /// again once gradients are destroyed outright and blocking replaces them. A "reject above N"
    /// gate would therefore discard a mid-rate sample while admitting the visibly worse one below
    /// it. Subtracting it keeps the ordering sane at every rate.
    /// </remarks>
    [JsonIgnore]
    public double DecisionQuality => RawQuality - CambiPenaltyWeight * (Cambi ?? 0);

    /// <summary>Harmonic-mean VMAF, falling back to the mean for samples scored before it existed.</summary>
    [JsonIgnore]
    public double RawQuality => VmafHarmonicMean is > 0 ? VmafHarmonicMean.Value : VmafMean;

    /// <summary>A copy scored under a different CAMBI weight, for sensitivity sweeps that must not touch the stored grid.</summary>
    internal EncodeGridPoint WithPenaltyWeight(double weight) {
        var copy = (EncodeGridPoint)MemberwiseClone();
        copy.CambiPenaltyWeight = weight;
        return copy;
    }
}

public sealed class DerivedLadderVariant {
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("resolution")]
    public string Resolution { get; set; } = "";

    [JsonPropertyName("bitrate")]
    public string Bitrate { get; set; } = "";

    [JsonPropertyName("bitrateBps")]
    public long BitrateBps { get; set; }

    [JsonPropertyName("predictedVmaf")]
    public double? PredictedVmaf { get; set; }

    [JsonPropertyName("predictedVmafHarmonic")]
    public double? PredictedVmafHarmonic { get; set; }

    [JsonPropertyName("predictedVmafMin")]
    public double? PredictedVmafMin { get; set; }

    /// <summary>CRF of the grid point this rung was taken from.</summary>
    [JsonPropertyName("crf")]
    public int? Crf { get; set; }

    /// <summary>Local hull slope ΔVMAF/Δlog₂(bitrate) at the operating point.</summary>
    [JsonPropertyName("hullSlope")]
    public double? HullSlope { get; set; }

    /// <summary>True when the rung lies inside the bitrate window where its resolution is the best choice.</summary>
    [JsonPropertyName("onEnvelope")]
    public bool? OnEnvelope { get; set; }

    /// <summary>How far below the pooled convex hull the rung sits, in decision-quality points.</summary>
    [JsonPropertyName("hullDeficit")]
    public double? HullDeficit { get; set; }

    /// <summary>
    /// True when the shared-slope operating point lay above the bitrate at which the next
    /// resolution up takes over, so the rung was pulled down to stay on the envelope.
    /// </summary>
    [JsonPropertyName("capped")]
    public bool? Capped { get; set; }

    /// <summary>The bitrate the rung was capped at — its resolution's upper crossover.</summary>
    [JsonPropertyName("capBps")]
    public long? CapBps { get; set; }

    /// <summary>
    /// True when the rung is the lowest-CRF sample of its resolution and the hull is still steeper
    /// than λ there: the tangent point lies past the sampled range, so the grid, not the content,
    /// set this rung.
    /// </summary>
    [JsonPropertyName("atGridBoundary")]
    public bool? AtGridBoundary { get; set; }

    /// <summary>A default-ladder rung added only because its resolution produced no measurement at all.</summary>
    [JsonPropertyName("fallback")]
    public bool? Fallback { get; set; }
}

/// <summary>Where the envelope hands over from one resolution to the next.</summary>
public sealed class CrossoverInfo {
    /// <summary>"upper&gt;lower": the resolution that wins above the bitrate, then the one below it.</summary>
    [JsonPropertyName("key")]
    public string Key { get; set; } = "";

    [JsonPropertyName("bitrateBps")]
    public long BitrateBps { get; set; }

    /// <summary>
    /// True when the crossover lies beyond the lower resolution's highest measured bitrate, so it
    /// rests on extending that curve flat rather than on a measurement.
    /// </summary>
    [JsonPropertyName("extrapolated")]
    public bool Extrapolated { get; set; }
}

public sealed class DerivedLadderDocument {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "vmaf-crossover";

    [JsonPropertyName("variants")]
    public List<DerivedLadderVariant> Variants { get; set; } = [];

    /// <summary>Lagrange multiplier all rungs were selected at, so they share an equal hull slope.</summary>
    [JsonPropertyName("lambda")]
    public double? Lambda { get; set; }

    /// <summary>Bitrates at which the envelope hands over from one resolution to the next, keyed "1080p&gt;720p".</summary>
    [JsonPropertyName("crossoverBps")]
    public Dictionary<string, long>? CrossoverBps { get; set; }

    /// <summary>The same crossovers with the flag saying whether each rests on a measurement.</summary>
    [JsonPropertyName("crossovers")]
    public List<CrossoverInfo>? Crossovers { get; set; }

    /// <summary>Resolutions measured but deliberately left out of the ladder, with the reason.</summary>
    [JsonPropertyName("dropped")]
    public Dictionary<string, string>? Dropped { get; set; }

    /// <summary>Things worth a reader's attention — chiefly rung gaps one rung per resolution cannot fill.</summary>
    [JsonPropertyName("warnings")]
    public List<string>? Warnings { get; set; }

    /// <summary>Harmonic VMAF below which grid samples were excluded from hull construction.</summary>
    [JsonPropertyName("qualityFloor")]
    public double? QualityFloor { get; set; }

    [JsonPropertyName("cambiPenaltyWeight")]
    public double? CambiPenaltyWeight { get; set; }
}

/// <summary>The animation ladder re-derived under one alternative CAMBI weight.</summary>
public sealed class LadderSensitivityEntry {
    [JsonPropertyName("weight")]
    public double Weight { get; set; }

    [JsonPropertyName("lambda")]
    public double? Lambda { get; set; }

    [JsonPropertyName("variants")]
    public List<DerivedLadderVariant> Variants { get; set; } = [];

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>
/// BD-rate of every derived ladder against the static baseline, computed from the bitrates and
/// scores actually measured on the packaged renditions of each.
/// </summary>
public sealed class LadderComparisonDocument {
    /// <summary>One entry per non-static ladder, keyed by ladder token ("dynamic", "animation").</summary>
    [JsonPropertyName("ladders")]
    public List<LadderComparisonEntry> Ladders { get; set; } = [];

    [JsonPropertyName("staticPoints")]
    public List<LadderComparisonPoint> StaticPoints { get; set; } = [];
}

public sealed class LadderComparisonEntry {
    [JsonPropertyName("ladderKind")]
    public string LadderKind { get; set; } = "";

    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("bdRatePercent")]
    public double BdRatePercent { get; set; }

    [JsonPropertyName("overlapLowVmaf")]
    public double OverlapLowVmaf { get; set; }

    [JsonPropertyName("overlapHighVmaf")]
    public double OverlapHighVmaf { get; set; }

    /// <summary>
    /// BD-rate restricted to the part of the overlap at or above VMAF 60 — the range a viewer
    /// would actually be served, so the low rungs cannot dominate the integral.
    /// </summary>
    [JsonPropertyName("bdRateHighBandPercent")]
    public double? BdRateHighBandPercent { get; set; }

    /// <summary>Bitrate saved at the midpoint of the overlapping quality range, in percent.</summary>
    [JsonPropertyName("bitrateSavingPercent")]
    public double? BitrateSavingPercent { get; set; }

    /// <summary>VMAF gained at equal bitrate, at the midpoint of the overlapping rate range.</summary>
    [JsonPropertyName("vmafGainAtEqualBitrate")]
    public double? VmafGainAtEqualBitrate { get; set; }

    [JsonPropertyName("points")]
    public List<LadderComparisonPoint> Points { get; set; } = [];

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public sealed class LadderComparisonPoint {
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("bitrateBps")]
    public long BitrateBps { get; set; }

    [JsonPropertyName("vmafHarmonicMean")]
    public double VmafHarmonicMean { get; set; }

    [JsonPropertyName("vmafMean")]
    public double VmafMean { get; set; }

    [JsonPropertyName("cambi")]
    public double? Cambi { get; set; }
}

/// <summary>
/// Default x264 against the animation-tuned encoder, joined on matched (resolution, CRF) samples
/// of the two encode grids.
/// </summary>
/// <remarks>
/// Taken from the grids rather than from packaged renditions on purpose: the two ladders differ in
/// bitrate by construction, so packaged rungs could never hold everything but the tune constant.
/// Grid samples share the full source, the resolution and the CRF, leaving the encoder settings as
/// the only difference.
/// </remarks>
public sealed class TuningComparisonDocument {
    [JsonPropertyName("tune")]
    public string? Tune { get; set; }

    [JsonPropertyName("decimate")]
    public bool Decimate { get; set; }

    /// <summary>Mean of the per-resolution BD-rates of the tuned curves against the untuned ones. Negative means tuning wins.</summary>
    [JsonPropertyName("bdRatePercent")]
    public double? BdRatePercent { get; set; }

    /// <summary>
    /// BD-rate per resolution. Each resolution's CRF sweep is a genuine rate-quality curve; the
    /// grid as a whole is not, because points from different resolutions interleave in bitrate.
    /// </summary>
    [JsonPropertyName("bdRateByResolution")]
    public Dictionary<string, double>? BdRateByResolution { get; set; }

    [JsonPropertyName("meanVmafDelta")]
    public double? MeanVmafDelta { get; set; }

    [JsonPropertyName("meanCambiDelta")]
    public double? MeanCambiDelta { get; set; }

    [JsonPropertyName("pairs")]
    public List<TuningComparisonPair> Pairs { get; set; } = [];

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public sealed class TuningComparisonPair {
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("height")]
    public int Height { get; set; }

    [JsonPropertyName("crf")]
    public int Crf { get; set; }

    [JsonPropertyName("baseVmaf")]
    public double BaseVmaf { get; set; }

    [JsonPropertyName("tunedVmaf")]
    public double TunedVmaf { get; set; }

    [JsonPropertyName("vmafDelta")]
    public double VmafDelta { get; set; }

    [JsonPropertyName("baseCambi")]
    public double? BaseCambi { get; set; }

    [JsonPropertyName("tunedCambi")]
    public double? TunedCambi { get; set; }

    [JsonPropertyName("baseBitrateBps")]
    public long BaseBitrateBps { get; set; }

    [JsonPropertyName("tunedBitrateBps")]
    public long TunedBitrateBps { get; set; }
}

/// <summary>How long one pipeline stage took, with the work size it was taken over.</summary>
public sealed class StageTiming {
    [JsonPropertyName("durationMs")]
    public long DurationMs { get; set; }

    /// <summary>Source frames processed — the time estimate scales with this.</summary>
    [JsonPropertyName("frames")]
    public int? Frames { get; set; }

    /// <summary>Source pixels per frame.</summary>
    [JsonPropertyName("pixels")]
    public long? Pixels { get; set; }

    /// <summary>Units of work inside the stage, e.g. grid samples or rungs.</summary>
    [JsonPropertyName("count")]
    public int? Count { get; set; }
}

/// <summary>
/// Evidence that both delivery formats carry the one encoded bitstream, and that packaging kept
/// segmentation, A/V sync and declared bandwidth identical between them.
/// </summary>
public sealed class PackagingIntegrityDocument {
    [JsonPropertyName("passed")]
    public bool Passed { get; set; }

    /// <summary>Every rung, in both protocols, cut at the same instants.</summary>
    [JsonPropertyName("segmentTablesIdentical")]
    public bool SegmentTablesIdentical { get; set; }

    [JsonPropertyName("problems")]
    public List<string> Problems { get; set; } = [];

    [JsonPropertyName("rungs")]
    public List<PackagingIntegrityRung> Rungs { get; set; } = [];
}

public sealed class PackagingIntegrityRung {
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";

    [JsonPropertyName("renditionSha256")]
    public string? RenditionSha256 { get; set; }

    [JsonPropertyName("hlsSha256")]
    public string? HlsSha256 { get; set; }

    [JsonPropertyName("dashSha256")]
    public string? DashSha256 { get; set; }

    [JsonPropertyName("renditionPackets")]
    public int? RenditionPackets { get; set; }

    [JsonPropertyName("hlsPackets")]
    public int? HlsPackets { get; set; }

    [JsonPropertyName("dashPackets")]
    public int? DashPackets { get; set; }

    [JsonPropertyName("hlsSegmentsSec")]
    public List<double>? HlsSegmentsSec { get; set; }

    [JsonPropertyName("dashSegmentsSec")]
    public List<double>? DashSegmentsSec { get; set; }

    /// <summary>Change in the A/V offset introduced by HLS packaging, against the encoded inputs.</summary>
    [JsonPropertyName("hlsAvDeltaMs")]
    public double? HlsAvDeltaMs { get; set; }

    [JsonPropertyName("dashAvDeltaMs")]
    public double? DashAvDeltaMs { get; set; }

    /// <summary>HLS BANDWIDTH — video peak plus audio peak.</summary>
    [JsonPropertyName("hlsBandwidthBps")]
    public long? HlsBandwidthBps { get; set; }

    [JsonPropertyName("hlsAverageBandwidthBps")]
    public long? HlsAverageBandwidthBps { get; set; }

    /// <summary>MPD video <c>@bandwidth</c> plus audio <c>@bandwidth</c>.</summary>
    [JsonPropertyName("dashBandwidthBps")]
    public long? DashBandwidthBps { get; set; }

    [JsonPropertyName("averageBps")]
    public long? AverageBps { get; set; }

    [JsonPropertyName("peakSegmentBps")]
    public long? PeakSegmentBps { get; set; }
}

public sealed class AnalysisSeriesDocument {
    [JsonPropertyName("siti")]
    public SitiSeriesData? Siti { get; set; }

    [JsonPropertyName("packagingIntegrity")]
    public PackagingIntegrityDocument? PackagingIntegrity { get; set; }

    [JsonPropertyName("sitiByFormat")]
    public FormatSitiSeriesDocument? SitiByFormat { get; set; }

    [JsonPropertyName("vmafByFormat")]
    public FormatVmafSeriesDocument? VmafByFormat { get; set; }

    [JsonPropertyName("encodeGrid")]
    public List<EncodeGridPoint>? EncodeGrid { get; set; }

    /// <summary>The same sweep re-run with the animation encoder settings.</summary>
    [JsonPropertyName("encodeGridAnimation")]
    public List<EncodeGridPoint>? EncodeGridAnimation { get; set; }

    [JsonPropertyName("derivedLadder")]
    public DerivedLadderDocument? DerivedLadder { get; set; }

    [JsonPropertyName("animationLadder")]
    public DerivedLadderDocument? AnimationLadder { get; set; }

    /// <summary>The animation ladder re-derived under alternative CAMBI weights, from the same grid.</summary>
    [JsonPropertyName("animationLadderSensitivity")]
    public List<LadderSensitivityEntry>? AnimationLadderSensitivity { get; set; }

    [JsonPropertyName("ladderComparison")]
    public LadderComparisonDocument? LadderComparison { get; set; }

    [JsonPropertyName("tuningComparison")]
    public TuningComparisonDocument? TuningComparison { get; set; }

    /// <summary>Share of source frames that repeat their predecessor — animation shot "on twos".</summary>
    [JsonPropertyName("duplicateFrameShare")]
    public double? DuplicateFrameShare { get; set; }

    /// <summary>
    /// CAMBI of the source scored against itself: the banding already in the master, so that
    /// banding added by compression can be told apart from banding the encoder was handed.
    /// </summary>
    [JsonPropertyName("sourceCambi")]
    public double? SourceCambi { get; set; }

    [JsonPropertyName("sourceCambiMax")]
    public double? SourceCambiMax { get; set; }

    /// <summary>Per-stage wall times of the run, keyed by pipeline step — the prior for the next run's estimate.</summary>
    [JsonPropertyName("stageTimings")]
    public Dictionary<string, StageTiming>? StageTimings { get; set; }

    /// <summary>
    /// Field-wise merge so SI/TI, VMAF, encode-grid, the derived ladder, and the ladder comparison
    /// can each be written independently without clobbering the others.
    /// </summary>
    /// <remarks>Every field added to this document must be added here too, or the next merge silently drops it.</remarks>
    public AnalysisSeriesDocument MergedWith(AnalysisSeriesDocument incoming) {
        return new AnalysisSeriesDocument {
            Siti = incoming.Siti ?? Siti,
            PackagingIntegrity = incoming.PackagingIntegrity ?? PackagingIntegrity,
            SitiByFormat = MergeSiti(SitiByFormat, incoming.SitiByFormat),
            VmafByFormat = MergeVmaf(VmafByFormat, incoming.VmafByFormat),
            EncodeGrid = incoming.EncodeGrid ?? EncodeGrid,
            EncodeGridAnimation = incoming.EncodeGridAnimation ?? EncodeGridAnimation,
            DerivedLadder = incoming.DerivedLadder ?? DerivedLadder,
            AnimationLadder = incoming.AnimationLadder ?? AnimationLadder,
            AnimationLadderSensitivity = incoming.AnimationLadderSensitivity ?? AnimationLadderSensitivity,
            LadderComparison = incoming.LadderComparison ?? LadderComparison,
            TuningComparison = incoming.TuningComparison ?? TuningComparison,
            DuplicateFrameShare = incoming.DuplicateFrameShare ?? DuplicateFrameShare,
            SourceCambi = incoming.SourceCambi ?? SourceCambi,
            SourceCambiMax = incoming.SourceCambiMax ?? SourceCambiMax,
            StageTimings = MergeTimings(StageTimings, incoming.StageTimings)
        };
    }

    private static Dictionary<string, StageTiming>? MergeTimings(
        Dictionary<string, StageTiming>? existing,
        Dictionary<string, StageTiming>? incoming) {
        if (incoming == null) {
            return existing;
        }

        if (existing == null) {
            return incoming;
        }

        var merged = new Dictionary<string, StageTiming>(existing);
        foreach (var (key, value) in incoming) {
            merged[key] = value;
        }

        return merged;
    }

    private static FormatSitiSeriesDocument? MergeSiti(
        FormatSitiSeriesDocument? existing,
        FormatSitiSeriesDocument? incoming) {
        if (incoming == null) {
            return existing;
        }

        if (existing == null) {
            return incoming;
        }

        return new FormatSitiSeriesDocument {
            Hls = incoming.Hls ?? existing.Hls,
            Dash = incoming.Dash ?? existing.Dash
        };
    }

    private static FormatVmafSeriesDocument? MergeVmaf(
        FormatVmafSeriesDocument? existing,
        FormatVmafSeriesDocument? incoming) {
        if (incoming == null) {
            return existing;
        }

        if (existing == null) {
            return incoming;
        }

        return new FormatVmafSeriesDocument {
            Hls = incoming.Hls ?? existing.Hls,
            Dash = incoming.Dash ?? existing.Dash
        };
    }
}

public sealed class AnalysisTarget {
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("label")]
    public required string Label { get; init; }

    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("transcodeId")]
    public string? TranscodeId { get; init; }

    [JsonPropertyName("ladderKind")]
    public string? LadderKind { get; init; }

    [JsonPropertyName("tree")]
    public AnalysisTreeDocument Tree { get; init; } = new();

    [JsonPropertyName("series")]
    public AnalysisSeriesDocument Series { get; init; } = new();
}

public sealed class FutureTestDescriptor {
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("label")]
    public required string Label { get; init; }

    [JsonPropertyName("status")]
    public required string Status { get; init; }
}

public sealed class VideoAnalysisResponse {
    public required string RouteId { get; init; }
    public int SchemaVersion { get; init; } = AnalysisSchema.Version;
    public DateTime? UpdatedAtUtc { get; init; }
    public List<AnalysisTarget> Targets { get; init; } = [];
    public List<FutureTestDescriptor> FutureTests { get; init; } = [];
}
