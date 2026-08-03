using System.Text.Json;
using System.Text.Json.Serialization;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

public enum AnalysisSectionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    NotImplemented
}

/// <summary>
/// Serializes enums as camelCase strings for the analysis API/frontend.
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
/// Aggregated VMAF statistics for one ladder rung — RD-curve coordinates for later encode-grid work.
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

    [JsonPropertyName("bitrateBps")]
    public long? BitrateBps { get; set; }
}

public sealed class VmafSeriesData {
    [JsonPropertyName("scores")]
    public List<double> Scores { get; set; } = [];

    [JsonPropertyName("timeSec")]
    public List<double>? TimeSec { get; set; }

    [JsonPropertyName("summary")]
    public VmafSummary Summary { get; set; } = new();
}

public sealed class FormatVmafSeriesDocument {
    [JsonPropertyName("hls")]
    public Dictionary<string, VmafSeriesData>? Hls { get; set; }

    [JsonPropertyName("dash")]
    public Dictionary<string, VmafSeriesData>? Dash { get; set; }
}

/// <summary>
/// One resolution×CRF encode-grid sample — RD point for convex-hull / crossover derivation.
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

    [JsonPropertyName("error")]
    public string? Error { get; set; }
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
}

public sealed class DerivedLadderDocument {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "vmaf-crossover";

    [JsonPropertyName("variants")]
    public List<DerivedLadderVariant> Variants { get; set; } = [];
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

    [JsonPropertyName("derivedLadder")]
    public DerivedLadderDocument? DerivedLadder { get; set; }
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

public sealed class VideoAnalysisDto {
    public required string RouteId { get; init; }
    public int SchemaVersion { get; init; } = 4;
    public DateTime? UpdatedAtUtc { get; init; }
    public List<AnalysisTarget> Targets { get; init; } = [];
    public List<FutureTestDescriptor> FutureTests { get; init; } = [];
}
