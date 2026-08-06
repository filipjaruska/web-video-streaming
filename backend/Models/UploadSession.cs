namespace WebWVideoStreamingAPI.Models;

public class UploadSession {
    public Guid Id { get; set; }
    public Guid VideoId { get; set; }
    public UploadSessionStatus Status { get; set; }
    public int ProgressPercent { get; set; }
    /// <summary>Human-readable pipeline phase while status is Processing (e.g. "SI/TI analysis").</summary>
    public string? CurrentStep { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UploadedAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }
    /// <summary>When the processing pipeline first started for this session.</summary>
    public DateTime? ProcessingStartedAtUtc { get; set; }
    /// <summary>Server-estimated seconds remaining; null when unknown / not processing.</summary>
    public int? EstimatedRemainingSeconds { get; set; }

    public Video Video { get; set; } = null!;
}
