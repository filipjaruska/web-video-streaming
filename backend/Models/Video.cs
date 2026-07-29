using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Models;

public class Video {
    public Guid Id { get; set; }
    public string RouteId { get; set; } = null!;
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? OriginalFileName { get; set; }
    public string? StorageKey { get; set; }
    public string? SourceContentType { get; set; }
    public long? SourceSizeBytes { get; set; }
    public Guid? ActiveTranscodeId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? PublishedAtUtc { get; set; }

    public Transcode? ActiveTranscode { get; set; }
    public VideoSourceAnalysis? SourceAnalysis { get; set; }
    public ICollection<UploadSession> UploadSessions { get; set; } = new List<UploadSession>();
    public ICollection<Transcode> Transcodes { get; set; } = new List<Transcode>();
}
