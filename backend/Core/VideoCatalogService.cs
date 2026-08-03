using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Core;

public sealed class VideoListItem {
    public required string RouteId { get; init; }
    public string? Title { get; init; }
    public string? FileName { get; init; }
    public string? ThumbnailUrl { get; init; }
    public long Size { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public DateTime? PublishedAtUtc { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

public sealed class VideoTranscodeListItem {
    public required string Id { get; init; }
    public required string LadderKind { get; init; }
    public required string Label { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
    public bool IsActive { get; init; }
    public required string Status { get; init; }
    public DateTime CreatedAtUtc { get; init; }
}

public sealed class VideoTranscodesResponse {
    public string? ActiveTranscodeId { get; init; }
    public required IReadOnlyList<VideoTranscodeListItem> Transcodes { get; init; }
}

public interface IVideoCatalogService {
    Task<Video?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<VideoListItem>> ListPublishedAsync(CancellationToken cancellationToken = default);
    Task<VideoTranscodesResponse?> ListTranscodesAsync(string routeId, CancellationToken cancellationToken = default);
    Task<Guid?> ResolveStreamTranscodeIdAsync(
        string routeId,
        Guid? requestedTranscodeId,
        bool requireHls,
        bool requireDash,
        CancellationToken cancellationToken = default);
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
            ThumbnailUrl = video.ThumbnailUrl,
            Size = video.SourceSizeBytes ?? 0,
            CreatedAtUtc = video.CreatedAtUtc,
            PublishedAtUtc = video.PublishedAtUtc,
            HasHls = video.ActiveTranscode?.HasHls == true,
            HasDash = video.ActiveTranscode?.HasDash == true
        }).ToList();
    }

    public async Task<VideoTranscodesResponse?> ListTranscodesAsync(
        string routeId,
        CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .AsNoTracking()
            .Include(item => item.Transcodes)
            .FirstOrDefaultAsync(
                item => item.RouteId == routeId && item.PublishedAtUtc != null,
                cancellationToken);

        if (video == null) {
            return null;
        }

        var items = video.Transcodes
            .Where(item =>
                item.Status is TranscodeStatus.Succeeded or TranscodeStatus.Running)
            .OrderBy(item => item.CreatedAtUtc)
            .Select(item => new VideoTranscodeListItem {
                Id = item.Id.ToString("N"),
                LadderKind = item.LadderKind == LadderKind.Dynamic ? "dynamic" : "static",
                Label = FormatLadderLabel(item.LadderKind),
                HasHls = item.HasHls,
                HasDash = item.HasDash,
                IsActive = video.ActiveTranscodeId == item.Id,
                Status = item.Status.ToString().ToLowerInvariant(),
                CreatedAtUtc = item.CreatedAtUtc
            })
            .ToList();

        return new VideoTranscodesResponse {
            ActiveTranscodeId = video.ActiveTranscodeId?.ToString("N"),
            Transcodes = items
        };
    }

    public async Task<Guid?> ResolveStreamTranscodeIdAsync(
        string routeId,
        Guid? requestedTranscodeId,
        bool requireHls,
        bool requireDash,
        CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .AsNoTracking()
            .Include(item => item.ActiveTranscode)
            .Include(item => item.Transcodes)
            .FirstOrDefaultAsync(
                item => item.RouteId == routeId && item.PublishedAtUtc != null,
                cancellationToken);

        if (video == null) {
            return null;
        }

        Transcode? transcode;
        if (requestedTranscodeId == null) {
            if (video.ActiveTranscodeId == null) {
                return null;
            }

            transcode = video.ActiveTranscode
                ?? video.Transcodes.FirstOrDefault(item => item.Id == video.ActiveTranscodeId);
        } else {
            transcode = video.Transcodes.FirstOrDefault(item => item.Id == requestedTranscodeId.Value);
        }

        if (transcode == null || transcode.Status != TranscodeStatus.Succeeded) {
            return null;
        }

        if (requireHls && !transcode.HasHls) {
            return null;
        }

        if (requireDash && !transcode.HasDash) {
            return null;
        }

        return transcode.Id;
    }

    private static string FormatLadderLabel(LadderKind ladderKind) =>
        ladderKind == LadderKind.Dynamic
            ? "Dynamic ladder (VMAF crossover)"
            : "Static ladder";

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
