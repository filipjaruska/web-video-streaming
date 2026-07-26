using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Services;

public sealed class TranscodeJobResult {
    public bool Success { get; init; }
    public Guid? TranscodeId { get; init; }
    public string? ErrorMessage { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

public interface IVideoTranscodeJobService {
    Task<TranscodeJobResult> TranscodeAsync(Guid videoId, CancellationToken cancellationToken = default);
    Task<TranscodeJobResult> TranscodeByRouteIdAsync(string routeId, CancellationToken cancellationToken = default);
}

public class VideoTranscodeJobService : IVideoTranscodeJobService {
    private readonly AppDbContext _dbContext;
    private readonly IVideoStorageService _storage;
    private readonly IVideoTranscodingService _transcoding;
    private readonly ILogger<VideoTranscodeJobService> _logger;

    public VideoTranscodeJobService(
        AppDbContext dbContext,
        IVideoStorageService storage,
        IVideoTranscodingService transcoding,
        ILogger<VideoTranscodeJobService> logger) {
        _dbContext = dbContext;
        _storage = storage;
        _transcoding = transcoding;
        _logger = logger;
    }

    public async Task<TranscodeJobResult> TranscodeByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos.FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);
        if (video == null) {
            return new TranscodeJobResult { Success = false, ErrorMessage = "Video not found" };
        }

        return await TranscodeAsync(video.Id, cancellationToken);
    }

    public async Task<TranscodeJobResult> TranscodeAsync(Guid videoId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .Include(item => item.UploadSessions)
            .FirstOrDefaultAsync(item => item.Id == videoId, cancellationToken);

        if (video == null) {
            return new TranscodeJobResult { Success = false, ErrorMessage = "Video not found" };
        }

        var sourcePath = _storage.ResolveSourcePath(video.RouteId);
        if (sourcePath == null) {
            return new TranscodeJobResult { Success = false, ErrorMessage = "Source video not found" };
        }

        var now = DateTime.UtcNow;
        var transcode = new Transcode {
            Id = Guid.NewGuid(),
            VideoId = video.Id,
            Status = TranscodeStatus.Running,
            CreatedAtUtc = now,
            StartedAtUtc = now
        };

        _dbContext.Transcodes.Add(transcode);

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Uploaded or UploadSessionStatus.Processing)) {
            session.Status = UploadSessionStatus.Processing;
            session.ProgressPercent = Math.Max(session.ProgressPercent, 40);
            session.UpdatedAtUtc = now;
        }

        video.UpdatedAtUtc = now;
        await _dbContext.SaveChangesAsync(cancellationToken);

        var hasHls = false;
        var hasDash = false;
        string? error = null;

        try {
            _storage.EnsureHlsDir(video.RouteId, transcode.Id);
            var hlsResult = await _transcoding.GenerateHlsAsync(
                sourcePath,
                _storage.GetHlsDir(video.RouteId, transcode.Id),
                cancellationToken: cancellationToken);

            hasHls = hlsResult.Success;
            if (!hlsResult.Success) {
                error = hlsResult.ErrorMessage;
            }

            _storage.EnsureDashDir(video.RouteId, transcode.Id);
            var dashResult = await _transcoding.GenerateDashAsync(
                sourcePath,
                _storage.GetDashDir(video.RouteId, transcode.Id),
                cancellationToken: cancellationToken);

            hasDash = dashResult.Success;
            if (!dashResult.Success) {
                error = string.IsNullOrEmpty(error)
                    ? dashResult.ErrorMessage
                    : $"{error}; {dashResult.ErrorMessage}";
            }

            try {
                var thumbPath = _storage.GetThumbnailPath(video.RouteId);
                var thumbResult = await _transcoding.ExtractThumbnailAsync(sourcePath, thumbPath, cancellationToken: cancellationToken);
                if (thumbResult.Success) {
                    video.ThumbnailUrl = $"/api/videos/{video.RouteId}/thumbnail";
                }
            } catch (Exception thumbEx) {
                _logger.LogWarning(thumbEx, "Thumbnail extraction failed for {RouteId}", video.RouteId);
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Transcode failed for video {VideoId}", videoId);
            error = ex.Message;
        }

        var completedAt = DateTime.UtcNow;
        transcode.HasHls = hasHls;
        transcode.HasDash = hasDash;
        transcode.CompletedAtUtc = completedAt;
        transcode.ErrorMessage = error;

        var succeeded = hasHls || hasDash;
        transcode.Status = succeeded ? TranscodeStatus.Succeeded : TranscodeStatus.Failed;

        if (succeeded) {
            video.ActiveTranscodeId = transcode.Id;
        }

        video.UpdatedAtUtc = completedAt;

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Processing or UploadSessionStatus.Uploaded)) {
            session.Status = succeeded ? UploadSessionStatus.Completed : UploadSessionStatus.Failed;
            session.ProgressPercent = succeeded ? 100 : session.ProgressPercent;
            session.CompletedAtUtc = completedAt;
            session.UpdatedAtUtc = completedAt;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return new TranscodeJobResult {
            Success = succeeded,
            TranscodeId = transcode.Id,
            ErrorMessage = error,
            HasHls = hasHls,
            HasDash = hasDash
        };
    }
}
