using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Analysis;

namespace WebWVideoStreamingAPI.Core;

// Serialized straight to the wire — property names are the JSON field names.
public sealed class VideoListItem {
    public required string RouteId { get; init; }
    public string? Title { get; init; }
    public string? FileName { get; init; }
    public string? ThumbnailUrl { get; init; }
    public long Size { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? PublishedAt { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

public sealed class ListVideosResponse {
    public int Count { get; init; }
    public required IReadOnlyList<VideoListItem> Videos { get; init; }
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

public sealed class VideoCatalogService {
    private readonly AppDbContext _dbContext;
    private readonly MediaPaths _paths;
    private readonly AnalysisStore _analysis;
    private readonly ILogger<VideoCatalogService> _logger;

    public VideoCatalogService(
        AppDbContext dbContext,
        MediaPaths paths,
        AnalysisStore analysis,
        ILogger<VideoCatalogService> logger) {
        _dbContext = dbContext;
        _paths = paths;
        _analysis = analysis;
        _logger = logger;
    }

    public Task<Video?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        return _dbContext.Videos
            .Include(video => video.ActiveTranscode)
            .FirstOrDefaultAsync(video => video.RouteId == routeId, cancellationToken);
    }

    public async Task<ListVideosResponse> ListPublishedAsync(CancellationToken cancellationToken = default) {
        var videos = await _dbContext.Videos
            .AsNoTracking()
            .Include(video => video.ActiveTranscode)
            .Where(video => video.PublishedAtUtc != null)
            .OrderByDescending(video => video.PublishedAtUtc)
            .ToListAsync(cancellationToken);

        var items = videos.Select(video => new VideoListItem {
            RouteId = video.RouteId,
            Title = video.Title,
            FileName = video.OriginalFileName ?? MediaNames.SourceFile,
            ThumbnailUrl = video.ThumbnailUrl,
            Size = video.SourceSizeBytes ?? 0,
            CreatedAt = video.CreatedAtUtc,
            PublishedAt = video.PublishedAtUtc,
            HasHls = video.ActiveTranscode?.HasHls == true,
            HasDash = video.ActiveTranscode?.HasDash == true
        }).ToList();

        return new ListVideosResponse { Count = items.Count, Videos = items };
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
            .Where(item => item.Status is TranscodeStatus.Succeeded or TranscodeStatus.Running)
            .OrderBy(item => item.CreatedAtUtc)
            .Select(item => new VideoTranscodeListItem {
                Id = item.Id.ToString("N"),
                LadderKind = AnalysisTargetBuilder.LadderToken(item.LadderKind),
                Label = AnalysisTargetBuilder.LadderLabel(item.LadderKind),
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

    /// <summary>
    /// Picks which packaging run should serve a stream: the requested one, or the active one when
    /// none was asked for. Returns null unless it succeeded and produced the required format.
    /// </summary>
    public async Task<Guid?> ResolveStreamTranscodeIdAsync(
        string routeId,
        Guid? requestedTranscodeId,
        bool requireHls,
        bool requireDash,
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

        var transcode = requestedTranscodeId == null
            ? video.Transcodes.FirstOrDefault(item => item.Id == video.ActiveTranscodeId)
            : video.Transcodes.FirstOrDefault(item => item.Id == requestedTranscodeId.Value);

        if (transcode == null || transcode.Status != TranscodeStatus.Succeeded) {
            return null;
        }

        if ((requireHls && !transcode.HasHls) || (requireDash && !transcode.HasDash)) {
            return null;
        }

        return transcode.Id;
    }

    public async Task<bool> DeleteByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .Include(item => item.Transcodes)
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return false;
        }

        // Analysis reports have no FK, so they are removed explicitly before the cascade.
        await _analysis.DeleteForVideoAsync(
            video.Id,
            video.Transcodes.Select(item => item.Id),
            cancellationToken);

        // Break the self-reference first — the FK is SetNull, not Cascade.
        video.ActiveTranscodeId = null;
        await _dbContext.SaveChangesAsync(cancellationToken);

        _dbContext.Videos.Remove(video);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _paths.DeleteVideoTree(routeId);
        _logger.LogInformation("Deleted video {RouteId} from catalog and storage", routeId);
        return true;
    }
}
