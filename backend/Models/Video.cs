namespace WebWVideoStreamingAPI.Models;

public class Video {
    public Guid Id { get; set; }
    public string RouteId { get; set; } = null!;
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? OriginalFileName { get; set; }
    public string? StorageKey { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public DateTime? PublishedAtUtc { get; set; }

    public ICollection<UploadSession> UploadSessions { get; set; } = new List<UploadSession>();
}
