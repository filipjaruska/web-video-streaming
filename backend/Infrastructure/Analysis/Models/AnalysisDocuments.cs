using System.Text.Json.Serialization;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

public enum AnalysisSectionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    NotImplemented
}

public sealed class AnalysisTreeNodeMeta {
    [JsonPropertyName("source")]
    public string? Source { get; set; }

    [JsonPropertyName("status")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
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

public sealed class AnalysisSeriesDocument {
    [JsonPropertyName("siti")]
    public SitiSeriesData? Siti { get; set; }
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
    public int SchemaVersion { get; init; } = 2;
    public DateTime? UpdatedAtUtc { get; init; }
    public List<AnalysisTarget> Targets { get; init; } = [];
    public List<FutureTestDescriptor> FutureTests { get; init; } = [];
}
