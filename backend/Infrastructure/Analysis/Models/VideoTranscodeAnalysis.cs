using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

public class VideoTranscodeAnalysis {
    public Guid TranscodeId { get; set; }
    public int SchemaVersion { get; set; } = 2;
    public string TreeJson { get; set; } = "{}";
    public string? SeriesJson { get; set; }
    public DateTime UpdatedAtUtc { get; set; }

    public Transcode Transcode { get; set; } = null!;
}
