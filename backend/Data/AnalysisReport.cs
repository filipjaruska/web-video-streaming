namespace WebWVideoStreamingAPI.Data;

/// <summary>Which kind of thing an <see cref="AnalysisReport"/> describes.</summary>
public enum AnalysisOwner {
    Source = 0,
    Transcode = 1
}

/// <summary>
/// One analysis document (tree + series JSON) for either a source video or a packaging run.
/// Keyed by (Owner, Id) so both kinds share a single table and a single store.
/// </summary>
public class AnalysisReport {
    public AnalysisOwner Owner { get; set; }

    /// <summary>VideoId when <see cref="Owner"/> is Source, TranscodeId when Transcode.</summary>
    public Guid Id { get; set; }

    public string TreeJson { get; set; } = "{}";
    public string? SeriesJson { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
