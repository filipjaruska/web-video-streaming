using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Infrastructure;
using WebWVideoStreamingAPI.Infrastructure.Analysis;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Core;

public sealed class VideoProcessingResult {
    public bool Success { get; init; }
    public Guid? TranscodeId { get; init; }
    public string? ErrorMessage { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

/// <summary>
/// Post-upload processing steps for a video (thumbnail → HLS → DASH).
/// </summary>
public sealed class VideoProcessingPipeline {
    private readonly AppDbContext _dbContext;
    private readonly IVideoStorageService _storage;
    private readonly IVideoTranscodingService _transcoding;
    private readonly IVideoSourceAnalysisService _analysis;
    private readonly IMediaProbeService _mediaProbe;
    private readonly ISitiAnalysisService _sitiAnalysis;
    private readonly ILogger<VideoProcessingPipeline> _logger;

    public VideoProcessingPipeline(
        AppDbContext dbContext,
        IVideoStorageService storage,
        IVideoTranscodingService transcoding,
        IVideoSourceAnalysisService analysis,
        IMediaProbeService mediaProbe,
        ISitiAnalysisService sitiAnalysis,
        ILogger<VideoProcessingPipeline> logger) {
        _dbContext = dbContext;
        _storage = storage;
        _transcoding = transcoding;
        _analysis = analysis;
        _mediaProbe = mediaProbe;
        _sitiAnalysis = sitiAnalysis;
        _logger = logger;
    }

    public async Task<VideoProcessingResult> RunAsync(Guid videoId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .Include(item => item.UploadSessions)
            .FirstOrDefaultAsync(item => item.Id == videoId, cancellationToken);

        if (video == null) {
            return new VideoProcessingResult { Success = false, ErrorMessage = "Video not found" };
        }

        var sourcePath = _storage.ResolveSourcePath(video.RouteId);
        if (sourcePath == null) {
            return new VideoProcessingResult { Success = false, ErrorMessage = "Source video not found" };
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
            await ExtractMediaInfoStepAsync(video, sourcePath, cancellationToken);
            await RunSitiAnalysisStepAsync(video, sourcePath, cancellationToken);
            await ExtractThumbnailStepAsync(video, sourcePath, cancellationToken);

            var hlsResult = await GenerateHlsStepAsync(video.RouteId, transcode.Id, sourcePath, cancellationToken);
            hasHls = hlsResult.Success;
            if (!hlsResult.Success) {
                error = hlsResult.ErrorMessage;
            }

            var dashResult = await GenerateDashStepAsync(video.RouteId, transcode.Id, sourcePath, cancellationToken);
            hasDash = dashResult.Success;
            if (!dashResult.Success) {
                error = string.IsNullOrEmpty(error)
                    ? dashResult.ErrorMessage
                    : $"{error}; {dashResult.ErrorMessage}";
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Processing failed for video {VideoId}", videoId);
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

        return new VideoProcessingResult {
            Success = succeeded,
            TranscodeId = transcode.Id,
            ErrorMessage = error,
            HasHls = hasHls,
            HasDash = hasDash
        };
    }

    private async Task ExtractMediaInfoStepAsync(
        Video video,
        string sourcePath,
        CancellationToken cancellationToken) {
        try {
            await _analysis.MarkSectionRunningAsync(
                video.Id,
                "general",
                "General",
                "ffprobe",
                cancellationToken);

            var probeResult = await _mediaProbe.ProbeAsync(sourcePath, cancellationToken);
            if (!probeResult.Success || probeResult.ProbeData == null) {
                await _analysis.MarkSectionFailedAsync(
                    video.Id,
                    "general",
                    "General",
                    "ffprobe",
                    probeResult.ErrorMessage ?? "Media probe failed",
                    cancellationToken);
                _logger.LogWarning(
                    "Media info step failed for {RouteId}: {Error}",
                    video.RouteId,
                    probeResult.ErrorMessage);
                return;
            }

            using (probeResult.ProbeData) {
                var sections = MediaInfoTreeBuilder.BuildSections(probeResult.ProbeData, sourcePath, video);
                await _analysis.UpsertSectionsAsync(video.Id, sections, cancellationToken);
            }

            _logger.LogInformation("Media info step succeeded for {RouteId}", video.RouteId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Media info step failed for {RouteId}", video.RouteId);
            await _analysis.MarkSectionFailedAsync(
                video.Id,
                "general",
                "General",
                "ffprobe",
                ex.Message,
                cancellationToken);
        }
    }

    private async Task RunSitiAnalysisStepAsync(
        Video video,
        string sourcePath,
        CancellationToken cancellationToken) {
        try {
            await _analysis.MarkSectionRunningAsync(
                video.Id,
                "siti",
                "SI/TI Analysis",
                "ffmpeg-siti",
                cancellationToken);

            var sitiResult = await _sitiAnalysis.AnalyzeAsync(sourcePath, cancellationToken);
            if (!sitiResult.Success || sitiResult.Series == null || sitiResult.Section == null) {
                await _analysis.MarkSectionFailedAsync(
                    video.Id,
                    "siti",
                    "SI/TI Analysis",
                    "ffmpeg-siti",
                    sitiResult.ErrorMessage ?? "SI/TI analysis failed",
                    cancellationToken);
                _logger.LogWarning(
                    "SI/TI step failed for {RouteId}: {Error}",
                    video.RouteId,
                    sitiResult.ErrorMessage);
                return;
            }

            await _analysis.SetSeriesAsync(video.Id, "siti", sitiResult.Series, cancellationToken);
            await _analysis.UpsertSectionAsync(video.Id, sitiResult.Section, cancellationToken);
            _logger.LogInformation("SI/TI step succeeded for {RouteId}", video.RouteId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "SI/TI step failed for {RouteId}", video.RouteId);
            await _analysis.MarkSectionFailedAsync(
                video.Id,
                "siti",
                "SI/TI Analysis",
                "ffmpeg-siti",
                ex.Message,
                cancellationToken);
        }
    }

    private async Task ExtractThumbnailStepAsync(
        Video video,
        string sourcePath,
        CancellationToken cancellationToken) {
        try {
            var thumbPath = _storage.GetThumbnailPath(video.RouteId);
            var thumbResult = await _transcoding.ExtractThumbnailAsync(
                sourcePath,
                thumbPath,
                cancellationToken: cancellationToken);

            if (thumbResult.Success) {
                video.ThumbnailUrl = $"/api/videos/{video.RouteId}/thumbnail";
                _logger.LogInformation("Thumbnail step succeeded for {RouteId}", video.RouteId);
            } else {
                _logger.LogWarning(
                    "Thumbnail step failed for {RouteId}: {Error}",
                    video.RouteId,
                    thumbResult.ErrorMessage);
            }
        } catch (Exception thumbEx) {
            _logger.LogWarning(thumbEx, "Thumbnail step failed for {RouteId}", video.RouteId);
        }
    }

    private async Task<TranscodeResult> GenerateHlsStepAsync(
        string routeId,
        Guid transcodeId,
        string sourcePath,
        CancellationToken cancellationToken) {
        _storage.EnsureHlsDir(routeId, transcodeId);
        _logger.LogInformation("HLS step started for {RouteId}", routeId);

        var result = await _transcoding.GenerateHlsAsync(
            sourcePath,
            _storage.GetHlsDir(routeId, transcodeId),
            cancellationToken: cancellationToken);

        if (result.Success) {
            _logger.LogInformation("HLS step succeeded for {RouteId}", routeId);
        } else {
            _logger.LogWarning("HLS step failed for {RouteId}: {Error}", routeId, result.ErrorMessage);
        }

        return result;
    }

    private async Task<TranscodeResult> GenerateDashStepAsync(
        string routeId,
        Guid transcodeId,
        string sourcePath,
        CancellationToken cancellationToken) {
        _storage.EnsureDashDir(routeId, transcodeId);
        _logger.LogInformation("DASH step started for {RouteId}", routeId);

        var result = await _transcoding.GenerateDashAsync(
            sourcePath,
            _storage.GetDashDir(routeId, transcodeId),
            cancellationToken: cancellationToken);

        if (result.Success) {
            _logger.LogInformation("DASH step succeeded for {RouteId}", routeId);
        } else {
            _logger.LogWarning("DASH step failed for {RouteId}: {Error}", routeId, result.ErrorMessage);
        }

        return result;
    }
}
