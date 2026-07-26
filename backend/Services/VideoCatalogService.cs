using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Services;

public sealed class VideoListItem {
    public required string RouteId { get; init; }
    public string? Title { get; init; }
    public string? FileName { get; init; }
    public long Size { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public DateTime? PublishedAtUtc { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

public interface IVideoCatalogService {
    Task<Video?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<VideoListItem>> ListPublishedAsync(CancellationToken cancellationToken = default);
    Task<bool> DeleteByRouteIdAsync(string routeId, CancellationToken cancellationToken = default);
}

public class VideoCatalogService : IVideoCatalogService {
    private readonly AppDbContext _dbContext;
    private readonly IVideoStorageService _storage;
    private readonly ILogger<VideoCatalogService> _logger;

    public VideoCatalogService(
        AppDbContext dbContext,
        IVideoStorageService storage,
        ILogger<VideoCatalogService> logger) {
        _dbContext = dbContext;
        _storage = storage;
        _logger = logger;
    }

    public Task<Video?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        return _dbContext.Videos
            .Include(video => video.ActiveTranscode)
            .FirstOrDefaultAsync(video => video.RouteId == routeId, cancellationToken);
    }

    public async Task<IReadOnlyList<VideoListItem>> ListPublishedAsync(CancellationToken cancellationToken = default) {
        var videos = await _dbContext.Videos
            .AsNoTracking()
            .Include(video => video.ActiveTranscode)
            .Where(video => video.PublishedAtUtc != null)
            .OrderByDescending(video => video.PublishedAtUtc)
            .ToListAsync(cancellationToken);

        return videos.Select(video => new VideoListItem {
            RouteId = video.RouteId,
            Title = video.Title,
            FileName = video.OriginalFileName ?? "source.mp4",
            Size = video.SourceSizeBytes ?? 0,
            CreatedAtUtc = video.CreatedAtUtc,
            PublishedAtUtc = video.PublishedAtUtc,
            HasHls = video.ActiveTranscode?.HasHls == true,
            HasDash = video.ActiveTranscode?.HasDash == true
        }).ToList();
    }

    public async Task<bool> DeleteByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return false;
        }

        video.ActiveTranscodeId = null;
        await _dbContext.SaveChangesAsync(cancellationToken);

        _dbContext.Videos.Remove(video);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _storage.DeleteVideoTree(routeId);
        _logger.LogInformation("Deleted video {RouteId} from catalog and storage", routeId);
        return true;
    }
}
