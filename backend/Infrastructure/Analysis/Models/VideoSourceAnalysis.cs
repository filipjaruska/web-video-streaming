using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

public class VideoSourceAnalysis {
    public Guid VideoId { get; set; }
    public int SchemaVersion { get; set; } = 2;
    public string TreeJson { get; set; } = "{}";
    public string? SeriesJson { get; set; }
    public DateTime UpdatedAtUtc { get; set; }

    public Video Video { get; set; } = null!;
}
