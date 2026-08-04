using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Infrastructure;
using WebWVideoStreamingAPI.Infrastructure.Analysis;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Core;

public sealed class VideoProcessingResult {
    public bool Success { get; init; }
    public Guid? TranscodeId { get; init; }
    public Guid? DynamicTranscodeId { get; init; }
    public string? ErrorMessage { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

/// <summary>
/// Post-upload pipeline: static ladder packaging + analysis → encode grid →
/// crossover derivation → dynamic ladder second packaging.
/// </summary>
public sealed class VideoProcessingPipeline {
    private readonly AppDbContext _dbContext;
    private readonly IVideoStorageService _storage;
    private readonly IVideoTranscodingService _transcoding;
    private readonly IVideoSourceAnalysisService _analysis;
    private readonly ITranscodeAnalysisCollector _transcodeAnalysis;
    private readonly IMediaProbeService _mediaProbe;
    private readonly ISitiAnalysisService _sitiAnalysis;
    private readonly IEncodeGridService _encodeGrid;
    private readonly ILadderDerivationService _ladderDerivation;
    private readonly ISubtitleExtractionService _subtitles;
    private readonly ILogger<VideoProcessingPipeline> _logger;

    public VideoProcessingPipeline(
        AppDbContext dbContext,
        IVideoStorageService storage,
        IVideoTranscodingService transcoding,
        IVideoSourceAnalysisService analysis,
        ITranscodeAnalysisCollector transcodeAnalysis,
        IMediaProbeService mediaProbe,
        ISitiAnalysisService sitiAnalysis,
        IEncodeGridService encodeGrid,
        ILadderDerivationService ladderDerivation,
        ISubtitleExtractionService subtitles,
        ILogger<VideoProcessingPipeline> logger) {
        _dbContext = dbContext;
        _storage = storage;
        _transcoding = transcoding;
        _analysis = analysis;
        _transcodeAnalysis = transcodeAnalysis;
        _mediaProbe = mediaProbe;
        _sitiAnalysis = sitiAnalysis;
        _encodeGrid = encodeGrid;
        _ladderDerivation = ladderDerivation;
        _subtitles = subtitles;
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

        await ReportSessionProgressAsync(video, 8, "Starting processing", cancellationToken);

        string? error = null;
        Guid? dynamicTranscodeId = null;

        // —— Source analysis (once) ——
        try {
            await ReportSessionProgressAsync(video, 10, "Reading media info", cancellationToken);
            await ExtractMediaInfoStepAsync(video, sourcePath, cancellationToken);

            await ReportSessionProgressAsync(video, 12, "Extracting subtitles", cancellationToken);
            await ExtractSubtitlesStepAsync(video, sourcePath, cancellationToken);

            await ReportSessionProgressAsync(video, 14, "SI/TI analysis", cancellationToken);
            await RunSitiAnalysisStepAsync(video, sourcePath, cancellationToken);

            await ReportSessionProgressAsync(video, 16, "Generating thumbnail", cancellationToken);
            await ExtractThumbnailStepAsync(video, sourcePath, cancellationToken);
        } catch (Exception ex) {
            _logger.LogError(ex, "Source analysis failed for video {VideoId}", videoId);
            error = ex.Message;
        }

        // —— Transcode 1: static ladder ——
        var staticProfile = TranscodeProfile.Default;
        var staticPackage = await PackageAndAnalyzeAsync(
            video,
            sourcePath,
            LadderKind.Static,
            staticProfile,
            derivedFrom: null,
            hlsProgress: 22,
            dashProgress: 28,
            sitiProgress: 32,
            vmafProgress: 40,
            cancellationToken);

        if (!string.IsNullOrEmpty(staticPackage.ErrorMessage)) {
            error = string.IsNullOrEmpty(error)
                ? staticPackage.ErrorMessage
                : $"{error}; {staticPackage.ErrorMessage}";
        }

        if (staticPackage.Succeeded) {
            video.ActiveTranscodeId = staticPackage.Transcode.Id;
            await _dbContext.SaveChangesAsync(cancellationToken);

            // —— Encode grid + derive dynamic ladder (soft-fail) ——
            try {
                await ReportSessionProgressAsync(video, 45, "Encode grid (CRF × resolution)", cancellationToken);
                var grid = await _encodeGrid.RunAsync(
                    video.RouteId,
                    staticPackage.Transcode.Id,
                    sourcePath,
                    onProgress: async (done, total, ct) => {
                        // Map grid completion across 45 → 76 (longest step).
                        var pct = total <= 0
                            ? 45
                            : 45 + (int)Math.Round(31.0 * done / total);
                        pct = Math.Clamp(pct, 45, 76);
                        await ReportSessionProgressAsync(
                            video,
                            pct,
                            $"Encode grid ({done}/{total})",
                            ct);
                    },
                    cancellationToken);

                if (grid.Success) {
                    await ReportSessionProgressAsync(video, 78, "Deriving VMAF crossover ladder", cancellationToken);
                    var derived = await _ladderDerivation.DeriveAsync(
                        staticPackage.Transcode.Id,
                        grid.Points,
                        cancellationToken);

                    if (derived.Success && derived.Profile != null) {
                        var dynamicPackage = await PackageAndAnalyzeAsync(
                            video,
                            sourcePath,
                            LadderKind.Dynamic,
                            derived.Profile,
                            derivedFrom: staticPackage.Transcode.Id,
                            hlsProgress: 82,
                            dashProgress: 86,
                            sitiProgress: 90,
                            vmafProgress: 95,
                            cancellationToken);

                        dynamicTranscodeId = dynamicPackage.Transcode.Id;
                        if (dynamicPackage.Succeeded) {
                            video.ActiveTranscodeId = dynamicPackage.Transcode.Id;
                            await _dbContext.SaveChangesAsync(cancellationToken);
                        } else if (!string.IsNullOrEmpty(dynamicPackage.ErrorMessage)) {
                            _logger.LogWarning(
                                "Dynamic ladder packaging failed for {RouteId}: {Error}",
                                video.RouteId,
                                dynamicPackage.ErrorMessage);
                        }
                    } else {
                        _logger.LogWarning(
                            "Ladder derivation failed for {RouteId}: {Error}",
                            video.RouteId,
                            derived.ErrorMessage);
                    }
                } else {
                    _logger.LogWarning(
                        "Encode grid failed for {RouteId}: {Error}",
                        video.RouteId,
                        grid.ErrorMessage);
                }
            } catch (Exception ex) {
                _logger.LogWarning(ex, "Dynamic ladder path failed for {RouteId}", video.RouteId);
            }
        }

        var completedAt = DateTime.UtcNow;
        var succeeded = staticPackage.Succeeded;
        video.UpdatedAtUtc = completedAt;

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Processing or UploadSessionStatus.Uploaded)) {
            session.Status = succeeded ? UploadSessionStatus.Completed : UploadSessionStatus.Failed;
            session.ProgressPercent = succeeded ? 100 : session.ProgressPercent;
            session.CurrentStep = succeeded ? null : session.CurrentStep;
            session.CompletedAtUtc = completedAt;
            session.UpdatedAtUtc = completedAt;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return new VideoProcessingResult {
            Success = succeeded,
            TranscodeId = staticPackage.Transcode.Id,
            DynamicTranscodeId = dynamicTranscodeId,
            ErrorMessage = error,
            HasHls = staticPackage.HasHls,
            HasDash = staticPackage.HasDash
        };
    }

    private sealed class PackageResult {
        public required Transcode Transcode { get; init; }
        public bool Succeeded { get; init; }
        public bool HasHls { get; init; }
        public bool HasDash { get; init; }
        public string? ErrorMessage { get; init; }
    }

    private async Task<PackageResult> PackageAndAnalyzeAsync(
        Video video,
        string sourcePath,
        LadderKind ladderKind,
        TranscodeProfile profile,
        Guid? derivedFrom,
        int hlsProgress,
        int dashProgress,
        int sitiProgress,
        int vmafProgress,
        CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;
        var transcode = new Transcode {
            Id = Guid.NewGuid(),
            VideoId = video.Id,
            Status = TranscodeStatus.Running,
            LadderKind = ladderKind,
            ProfileJson = _ladderDerivation.SerializeProfile(profile),
            DerivedFromTranscodeId = derivedFrom,
            CreatedAtUtc = now,
            StartedAtUtc = now
        };

        _dbContext.Transcodes.Add(transcode);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var hasHls = false;
        var hasDash = false;
        string? error = null;

        try {
            await ReportSessionProgressAsync(
                video,
                hlsProgress,
                ladderKind == LadderKind.Dynamic ? "Dynamic HLS packaging" : "HLS transcoding",
                cancellationToken);
            var hlsResult = await GenerateHlsStepAsync(video.RouteId, transcode.Id, sourcePath, profile, cancellationToken);
            hasHls = hlsResult.Success;
            if (!hlsResult.Success) {
                error = hlsResult.ErrorMessage;
            }

            await ReportSessionProgressAsync(
                video,
                dashProgress,
                ladderKind == LadderKind.Dynamic ? "Dynamic DASH packaging" : "DASH transcoding",
                cancellationToken);
            var dashResult = await GenerateDashStepAsync(video.RouteId, transcode.Id, sourcePath, profile, cancellationToken);
            hasDash = dashResult.Success;
            if (!dashResult.Success) {
                error = string.IsNullOrEmpty(error)
                    ? dashResult.ErrorMessage
                    : $"{error}; {dashResult.ErrorMessage}";
            }

            if (hasHls || hasDash) {
                await ReportSessionProgressAsync(
                    video,
                    sitiProgress,
                    ladderKind == LadderKind.Dynamic
                        ? "Analyzing dynamic ladder (SI/TI)"
                        : "Analyzing transcodes (SI/TI)",
                    cancellationToken);
                await _transcodeAnalysis.CollectAsync(
                    video.RouteId,
                    transcode.Id,
                    hasHls,
                    hasDash,
                    profile,
                    cancellationToken);

                await ReportSessionProgressAsync(
                    video,
                    vmafProgress,
                    ladderKind == LadderKind.Dynamic ? "Dynamic ladder VMAF" : "VMAF analysis",
                    cancellationToken);
                await _transcodeAnalysis.CollectVmafAsync(
                    video.RouteId,
                    transcode.Id,
                    hasHls,
                    hasDash,
                    profile,
                    cancellationToken);
            }
        } catch (Exception ex) {
            _logger.LogError(
                ex,
                "{Ladder} packaging failed for video {VideoId}",
                ladderKind,
                video.Id);
            error = ex.Message;
        }

        var completedAt = DateTime.UtcNow;
        var succeeded = hasHls || hasDash;
        transcode.HasHls = hasHls;
        transcode.HasDash = hasDash;
        transcode.CompletedAtUtc = completedAt;
        transcode.ErrorMessage = error;
        transcode.Status = succeeded ? TranscodeStatus.Succeeded : TranscodeStatus.Failed;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new PackageResult {
            Transcode = transcode,
            Succeeded = succeeded,
            HasHls = hasHls,
            HasDash = hasDash,
            ErrorMessage = error
        };
    }

    private async Task ReportSessionProgressAsync(
        Video video,
        int progressPercent,
        string currentStep,
        CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Uploaded
                         or UploadSessionStatus.Processing
                         or UploadSessionStatus.Uploading)) {
            session.Status = UploadSessionStatus.Processing;
            session.ProgressPercent = Math.Max(session.ProgressPercent, progressPercent);
            session.CurrentStep = currentStep;
            session.UpdatedAtUtc = now;
        }

        video.UpdatedAtUtc = now;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task ExtractSubtitlesStepAsync(
        Video video,
        string sourcePath,
        CancellationToken cancellationToken) {
        try {
            await _analysis.MarkSectionRunningAsync(
                video.Id,
                "subtitles",
                "Subtitles",
                "ffmpeg-webvtt",
                cancellationToken);

            var result = await _subtitles.ExtractAsync(video.RouteId, sourcePath, cancellationToken);
            if (result.Section != null) {
                await _analysis.UpsertSectionAsync(video.Id, result.Section, cancellationToken);
            }

            if (!result.Success) {
                await _analysis.MarkSectionFailedAsync(
                    video.Id,
                    "subtitles",
                    "Subtitles",
                    "ffmpeg-webvtt",
                    result.ErrorMessage ?? "Subtitle extraction failed",
                    cancellationToken);
                _logger.LogWarning(
                    "Subtitle extraction failed for {RouteId}: {Error}",
                    video.RouteId,
                    result.ErrorMessage);
                return;
            }

            _logger.LogInformation(
                "Subtitle extraction succeeded for {RouteId} ({TrackCount} tracks)",
                video.RouteId,
                result.Manifest.Tracks.Count);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Subtitle extraction failed for {RouteId}", video.RouteId);
            await _analysis.MarkSectionFailedAsync(
                video.Id,
                "subtitles",
                "Subtitles",
                "ffmpeg-webvtt",
                ex.Message,
                cancellationToken);
        }
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
                var legacyJpg = Path.Combine(_storage.GetSourceDir(video.RouteId), "thumb.jpg");
                if (File.Exists(legacyJpg)) {
                    File.Delete(legacyJpg);
                }

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
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        _storage.EnsureHlsDir(routeId, transcodeId);
        _logger.LogInformation("HLS step started for {RouteId} profile={Profile}", routeId, profile.Name);

        var result = await _transcoding.GenerateHlsAsync(
            sourcePath,
            _storage.GetHlsDir(routeId, transcodeId),
            profile,
            cancellationToken);

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
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        _storage.EnsureDashDir(routeId, transcodeId);
        _logger.LogInformation("DASH step started for {RouteId} profile={Profile}", routeId, profile.Name);

        var result = await _transcoding.GenerateDashAsync(
            sourcePath,
            _storage.GetDashDir(routeId, transcodeId),
            profile,
            cancellationToken);

        if (result.Success) {
            _logger.LogInformation("DASH step succeeded for {RouteId}", routeId);
        } else {
            _logger.LogWarning("DASH step failed for {RouteId}: {Error}", routeId, result.ErrorMessage);
        }

        return result;
    }
}
