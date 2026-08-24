using System.Text.Json;
using System.Text.Json.Serialization;

namespace WebWVideoStreamingAPI.Analysis;

public static class AnalysisSchema {
    /// <summary>Version echoed to the frontend on every analysis response.</summary>
    public const int Version = 5;

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

    /// <summary>Bitrate actually measured on the scored file.</summary>
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

    /// <summary>
    /// Weight applied to <see cref="Cambi"/> when scoring this point, in VMAF points per unit of
    /// CAMBI. Zero for the generic ladders; the animation ladder sets it so that banding, which
    /// VMAF barely notices but which is the dominant artifact on flat cel-shaded areas, actually
    /// costs a candidate something.
    /// </summary>
    [JsonIgnore]
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
    public double DecisionQuality =>
        (VmafHarmonicMean is > 0 ? VmafHarmonicMean.Value : VmafMean) -
        CambiPenaltyWeight * (Cambi ?? 0);
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
}

public sealed class DerivedLadderDocument {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "vmaf-crossover";

    [JsonPropertyName("variants")]
    public List<DerivedLadderVariant> Variants { get; set; } = [];

    /// <summary>Lagrange multiplier all rungs were selected at, so they share an equal hull slope.</summary>
    [JsonPropertyName("lambda")]
    public double? Lambda { get; set; }

    /// <summary>Bitrates at which the hull hands over from one resolution to the next, keyed "1080p&gt;720p".</summary>
    [JsonPropertyName("crossoverBps")]
    public Dictionary<string, long>? CrossoverBps { get; set; }

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
/// Grid samples share the source excerpt, the resolution and the CRF, leaving the encoder settings
/// as the only difference.
/// </remarks>
public sealed class TuningComparisonDocument {
    [JsonPropertyName("tune")]
    public string? Tune { get; set; }

    [JsonPropertyName("decimate")]
    public bool Decimate { get; set; }

    /// <summary>BD-rate of the tuned curve against the untuned one. Negative means tuning wins.</summary>
    [JsonPropertyName("bdRatePercent")]
    public double? BdRatePercent { get; set; }

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

public sealed class AnalysisSeriesDocument {
    [JsonPropertyName("siti")]
    public SitiSeriesData? Siti { get; set; }

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

    [JsonPropertyName("ladderComparison")]
    public LadderComparisonDocument? LadderComparison { get; set; }

    [JsonPropertyName("tuningComparison")]
    public TuningComparisonDocument? TuningComparison { get; set; }

    /// <summary>Share of source frames identical to their predecessor — animation shot "on twos".</summary>
    [JsonPropertyName("duplicateFrameShare")]
    public double? DuplicateFrameShare { get; set; }

    /// <summary>
    /// Field-wise merge so SI/TI, VMAF, encode-grid, the derived ladder, and the ladder comparison
    /// can each be written independently without clobbering the others.
    /// </summary>
    public AnalysisSeriesDocument MergedWith(AnalysisSeriesDocument incoming) {
        return new AnalysisSeriesDocument {
            Siti = incoming.Siti ?? Siti,
            SitiByFormat = MergeSiti(SitiByFormat, incoming.SitiByFormat),
            VmafByFormat = MergeVmaf(VmafByFormat, incoming.VmafByFormat),
            EncodeGrid = incoming.EncodeGrid ?? EncodeGrid,
            EncodeGridAnimation = incoming.EncodeGridAnimation ?? EncodeGridAnimation,
            DerivedLadder = incoming.DerivedLadder ?? DerivedLadder,
            AnimationLadder = incoming.AnimationLadder ?? AnimationLadder,
            LadderComparison = incoming.LadderComparison ?? LadderComparison,
            TuningComparison = incoming.TuningComparison ?? TuningComparison,
            DuplicateFrameShare = incoming.DuplicateFrameShare ?? DuplicateFrameShare
        };
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
