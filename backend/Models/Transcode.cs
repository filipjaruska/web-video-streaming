using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Models;

public class Transcode {
    public Guid Id { get; set; }
    public Guid VideoId { get; set; }
    public TranscodeStatus Status { get; set; }
    public bool HasHls { get; set; }
    public bool HasDash { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? StartedAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }

    public Video Video { get; set; } = null!;
    public VideoTranscodeAnalysis? Analysis { get; set; }
}
