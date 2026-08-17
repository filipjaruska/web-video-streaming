using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Analysis;

namespace WebWVideoStreamingAPI.Core;

public sealed class ProcessingResult {
    public bool Success { get; init; }
    public Guid? TranscodeId { get; init; }
    public Guid? DynamicTranscodeId { get; init; }
    public string? ErrorMessage { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

/// <summary>
/// Post-upload pipeline: source analysis, then static ladder packaging + analysis, then the encode
/// grid, crossover derivation, and a second packaging pass on the derived dynamic ladder.
/// </summary>
public sealed class ProcessingPipeline {
    private readonly AppDbContext _dbContext;
    private readonly MediaPaths _paths;
    private readonly Transcoder _transcoder;
    private readonly MediaProbe _probe;
    private readonly SitiAnalyzer _siti;
    private readonly SubtitleExtractor _subtitles;
    private readonly AnalysisStore _analysis;
    private readonly TranscodeAnalysisCollector _collector;
    private readonly EncodeGrid _encodeGrid;
    private readonly LadderDerivation _ladderDerivation;
    private readonly ILogger<ProcessingPipeline> _logger;

    public ProcessingPipeline(
        AppDbContext dbContext,
        MediaPaths paths,
        Transcoder transcoder,
        MediaProbe probe,
        SitiAnalyzer siti,
        SubtitleExtractor subtitles,
        AnalysisStore analysis,
        TranscodeAnalysisCollector collector,
        EncodeGrid encodeGrid,
        LadderDerivation ladderDerivation,
        ILogger<ProcessingPipeline> logger) {
        _dbContext = dbContext;
        _paths = paths;
        _transcoder = transcoder;
        _probe = probe;
        _siti = siti;
        _subtitles = subtitles;
        _analysis = analysis;
        _collector = collector;
        _encodeGrid = encodeGrid;
        _ladderDerivation = ladderDerivation;
        _logger = logger;
    }

    public async Task<ProcessingResult> RunAsync(Guid videoId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .Include(item => item.UploadSessions)
            .FirstOrDefaultAsync(item => item.Id == videoId, cancellationToken);

        if (video == null) {
            return new ProcessingResult { Success = false, ErrorMessage = "Video not found" };
        }

        var sourcePath = _paths.ResolveSource(video.RouteId);
        if (sourcePath == null) {
            return new ProcessingResult { Success = false, ErrorMessage = "Source video not found" };
        }

        await ReportAsync(video, PipelineStep.Starting, cancellationToken);

        var error = await RunSourceAnalysisAsync(video, sourcePath, cancellationToken);

        var staticPackage = await PackageAndAnalyzeAsync(
            video,
            sourcePath,
            LadderKind.Static,
            TranscodeProfile.Default,
            derivedFrom: null,
            PipelineStep.StaticHls,
            PipelineStep.StaticDash,
            PipelineStep.StaticSiti,
            PipelineStep.StaticVmaf,
            cancellationToken);

        error = Combine(error, staticPackage.ErrorMessage);

        Guid? dynamicTranscodeId = null;
        if (staticPackage.Succeeded) {
            video.ActiveTranscodeId = staticPackage.Transcode.Id;
            await _dbContext.SaveChangesAsync(cancellationToken);

            dynamicTranscodeId = await RunDynamicLadderAsync(
                video,
                sourcePath,
                staticPackage.Transcode.Id,
                cancellationToken);
        }

        await CompleteSessionsAsync(video, staticPackage.Succeeded, cancellationToken);

        return new ProcessingResult {
            Success = staticPackage.Succeeded,
            TranscodeId = staticPackage.Transcode.Id,
            DynamicTranscodeId = dynamicTranscodeId,
            ErrorMessage = error,
            HasHls = staticPackage.HasHls,
            HasDash = staticPackage.HasDash
        };
    }

    // —— Source analysis ——————————————————————————————————————————————————

    private async Task<string?> RunSourceAnalysisAsync(
        Video video,
        string sourcePath,
        CancellationToken cancellationToken) {
        try {
            await ReportAsync(video, PipelineStep.MediaInfo, cancellationToken);
            await RunSourceStepAsync(video, "general", "General", "ffprobe", async ct => {
                var probe = await _probe.ProbeAsync(sourcePath, ct);
                if (!probe.Success || probe.ProbeData == null) {
                    return StepOutcome.Failed(probe.ErrorMessage ?? "Media probe failed");
                }

                using (probe.ProbeData) {
                    return StepOutcome.Ok(MediaInfoTree.BuildSections(probe.ProbeData, sourcePath, video));
                }
            }, cancellationToken);

            await ReportAsync(video, PipelineStep.Subtitles, cancellationToken);
            await RunSourceStepAsync(video, "subtitles", "Subtitles", "ffmpeg-webvtt", async ct => {
                var result = await _subtitles.ExtractAsync(video.RouteId, sourcePath, ct);
                var sections = result.Section != null ? new List<AnalysisTreeNode> { result.Section } : null;
                return result.Success
                    ? StepOutcome.Ok(sections)
                    : StepOutcome.Failed(result.ErrorMessage ?? "Subtitle extraction failed", sections);
            }, cancellationToken);

            await ReportAsync(video, PipelineStep.SourceSiti, cancellationToken);
            await RunSourceStepAsync(video, "siti", "SI/TI Analysis", "ffmpeg-siti", async ct => {
                var result = await _siti.AnalyzeAsync(sourcePath, ct);
                if (!result.Success || result.Series == null || result.Section == null) {
                    return StepOutcome.Failed(result.ErrorMessage ?? "SI/TI analysis failed");
                }

                return StepOutcome.Ok([result.Section], new AnalysisSeriesDocument { Siti = result.Series });
            }, cancellationToken);

            await ReportAsync(video, PipelineStep.Thumbnail, cancellationToken);
            await ExtractThumbnailAsync(video, sourcePath, cancellationToken);

            return null;
        } catch (Exception ex) {
            _logger.LogError(ex, "Source analysis failed for video {VideoId}", video.Id);
            return ex.Message;
        }
    }

    /// <summary>
    /// What one source-analysis step produced: sections to graft into the tree, an optional series
    /// patch, and whether it worked.
    /// </summary>
    private sealed record StepOutcome(
        bool Success,
        string? ErrorMessage,
        IReadOnlyList<AnalysisTreeNode>? Sections,
        AnalysisSeriesDocument? Series) {
        public static StepOutcome Ok(IReadOnlyList<AnalysisTreeNode>? sections, AnalysisSeriesDocument? series = null) =>
            new(true, null, sections, series);

        public static StepOutcome Failed(string message, IReadOnlyList<AnalysisTreeNode>? sections = null) =>
            new(false, message, sections, null);
    }

    /// <summary>
    /// Runs one source-analysis step: mark the section running, do the work, then write what it
    /// produced or mark it failed. Every step shares this shape, including when it throws.
    /// </summary>
    private async Task RunSourceStepAsync(
        Video video,
        string sectionId,
        string label,
        string source,
        Func<CancellationToken, Task<StepOutcome>> work,
        CancellationToken cancellationToken) {
        try {
            await _analysis.MarkRunningAsync(AnalysisOwner.Source, video.Id, sectionId, label, source, cancellationToken);

            var outcome = await work(cancellationToken);

            if (outcome.Sections is { Count: > 0 }) {
                await _analysis.UpsertSectionsAsync(AnalysisOwner.Source, video.Id, outcome.Sections, cancellationToken);
            }

            if (outcome.Series != null) {
                await _analysis.MergeSeriesAsync(AnalysisOwner.Source, video.Id, outcome.Series, cancellationToken);
            }

            if (!outcome.Success) {
                await _analysis.MarkFailedAsync(
                    AnalysisOwner.Source,
                    video.Id,
                    sectionId,
                    label,
                    source,
                    outcome.ErrorMessage ?? $"{label} failed",
                    cancellationToken);
                _logger.LogWarning("{Step} failed for {RouteId}: {Error}", label, video.RouteId, outcome.ErrorMessage);
                return;
            }

            _logger.LogInformation("{Step} succeeded for {RouteId}", label, video.RouteId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "{Step} failed for {RouteId}", label, video.RouteId);
            await _analysis.MarkFailedAsync(
                AnalysisOwner.Source,
                video.Id,
                sectionId,
                label,
                source,
                ex.Message,
                cancellationToken);
        }
    }

    private async Task ExtractThumbnailAsync(Video video, string sourcePath, CancellationToken cancellationToken) {
        try {
            var result = await _transcoder.ExtractThumbnailAsync(
                sourcePath,
                _paths.ThumbnailFile(video.RouteId),
                cancellationToken: cancellationToken);

            if (!result.Success) {
                _logger.LogWarning("Thumbnail step failed for {RouteId}: {Error}", video.RouteId, result.ErrorMessage);
                return;
            }

            // An older run may have left a JPEG behind; the WebP supersedes it.
            var legacy = _paths.LegacyThumbnailFile(video.RouteId);
            if (File.Exists(legacy)) {
                File.Delete(legacy);
            }

            video.ThumbnailUrl = $"/api/videos/{video.RouteId}/thumbnail";
            _logger.LogInformation("Thumbnail step succeeded for {RouteId}", video.RouteId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Thumbnail step failed for {RouteId}", video.RouteId);
        }
    }

    // —— Packaging ————————————————————————————————————————————————————————

    private sealed record PackageResult(
        Transcode Transcode,
        bool Succeeded,
        bool HasHls,
        bool HasDash,
        string? ErrorMessage);

    private async Task<PackageResult> PackageAndAnalyzeAsync(
        Video video,
        string sourcePath,
        LadderKind ladderKind,
        TranscodeProfile profile,
        Guid? derivedFrom,
        PipelineStep hlsStep,
        PipelineStep dashStep,
        PipelineStep sitiStep,
        PipelineStep vmafStep,
        CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;
        var transcode = new Transcode {
            Id = Guid.NewGuid(),
            VideoId = video.Id,
            Status = TranscodeStatus.Running,
            LadderKind = ladderKind,
            ProfileJson = profile.ToJson(),
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
            await ReportAsync(video, hlsStep, cancellationToken);
            var hls = await PackageFormatAsync(video.RouteId, transcode.Id, sourcePath, profile, dash: false, cancellationToken);
            hasHls = hls.Success;
            error = Combine(error, hls.ErrorMessage);

            await ReportAsync(video, dashStep, cancellationToken);
            var dash = await PackageFormatAsync(video.RouteId, transcode.Id, sourcePath, profile, dash: true, cancellationToken);
            hasDash = dash.Success;
            error = Combine(error, dash.ErrorMessage);

            if (hasHls || hasDash) {
                await ReportAsync(video, sitiStep, cancellationToken);
                await _collector.CollectAsync(video.RouteId, transcode.Id, hasHls, hasDash, profile, cancellationToken);

                await ReportAsync(video, vmafStep, cancellationToken);
                await _collector.CollectVmafAsync(video.RouteId, transcode.Id, hasHls, hasDash, profile, cancellationToken);
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "{Ladder} packaging failed for video {VideoId}", ladderKind, video.Id);
            error = ex.Message;
        }

        var succeeded = hasHls || hasDash;
        transcode.HasHls = hasHls;
        transcode.HasDash = hasDash;
        transcode.CompletedAtUtc = DateTime.UtcNow;
        transcode.ErrorMessage = error;
        transcode.Status = succeeded ? TranscodeStatus.Succeeded : TranscodeStatus.Failed;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new PackageResult(transcode, succeeded, hasHls, hasDash, error);
    }

    private async Task<TranscodeResult> PackageFormatAsync(
        string routeId,
        Guid transcodeId,
        string sourcePath,
        TranscodeProfile profile,
        bool dash,
        CancellationToken cancellationToken) {
        var format = dash ? "DASH" : "HLS";

        string outputDir;
        if (dash) {
            _paths.EnsureDashDir(routeId, transcodeId);
            outputDir = _paths.DashDir(routeId, transcodeId);
        } else {
            _paths.EnsureHlsDir(routeId, transcodeId);
            outputDir = _paths.HlsDir(routeId, transcodeId);
        }

        _logger.LogInformation("{Format} step started for {RouteId} profile={Profile}", format, routeId, profile.Name);

        var result = dash
            ? await _transcoder.GenerateDashAsync(sourcePath, outputDir, profile, cancellationToken)
            : await _transcoder.GenerateHlsAsync(sourcePath, outputDir, profile, cancellationToken);

        if (result.Success) {
            _logger.LogInformation("{Format} step succeeded for {RouteId}", format, routeId);
        } else {
            _logger.LogWarning("{Format} step failed for {RouteId}: {Error}", format, routeId, result.ErrorMessage);
        }

        return result;
    }

    // —— Dynamic ladder ————————————————————————————————————————————————————

    /// <summary>
    /// Sweeps the encode grid, derives a crossover ladder from it, and packages that ladder.
    /// Entirely soft-fail: the static ladder is already serving, so anything here that goes wrong
    /// is logged and the run still counts as a success.
    /// </summary>
    private async Task<Guid?> RunDynamicLadderAsync(
        Video video,
        string sourcePath,
        Guid staticTranscodeId,
        CancellationToken cancellationToken) {
        try {
            await ReportAsync(video, PipelineStep.EncodeGrid, cancellationToken);

            var grid = await _encodeGrid.RunAsync(
                video.RouteId,
                staticTranscodeId,
                sourcePath,
                onProgress: (done, total, ct) => ReportGridAsync(video, done, total, ct),
                cancellationToken);

            if (!grid.Success) {
                _logger.LogWarning("Encode grid failed for {RouteId}: {Error}", video.RouteId, grid.ErrorMessage);
                return null;
            }

            await ReportAsync(video, PipelineStep.DeriveLadder, cancellationToken);
            var derived = await _ladderDerivation.DeriveAsync(staticTranscodeId, grid.Points, cancellationToken);

            if (!derived.Success || derived.Profile == null) {
                _logger.LogWarning("Ladder derivation failed for {RouteId}: {Error}", video.RouteId, derived.ErrorMessage);
                return null;
            }

            var dynamicPackage = await PackageAndAnalyzeAsync(
                video,
                sourcePath,
                LadderKind.Dynamic,
                derived.Profile,
                derivedFrom: staticTranscodeId,
                PipelineStep.DynamicHls,
                PipelineStep.DynamicDash,
                PipelineStep.DynamicSiti,
                PipelineStep.DynamicVmaf,
                cancellationToken);

            if (dynamicPackage.Succeeded) {
                video.ActiveTranscodeId = dynamicPackage.Transcode.Id;
                await _dbContext.SaveChangesAsync(cancellationToken);
            } else {
                _logger.LogWarning(
                    "Dynamic ladder packaging failed for {RouteId}: {Error}",
                    video.RouteId,
                    dynamicPackage.ErrorMessage);
            }

            return dynamicPackage.Transcode.Id;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Dynamic ladder path failed for {RouteId}", video.RouteId);
            return null;
        }
    }

    // —— Session progress ——————————————————————————————————————————————————

    private Task ReportAsync(Video video, PipelineStep step, CancellationToken cancellationToken) =>
        WriteProgressAsync(
            video,
            ProcessingEta.PercentFor(step),
            ProcessingEta.LabelFor(step),
            gridDone: null,
            gridTotal: null,
            cancellationToken);

    private Task ReportGridAsync(Video video, int done, int total, CancellationToken cancellationToken) =>
        WriteProgressAsync(
            video,
            ProcessingEta.GridPercent(done, total),
            ProcessingEta.GridLabel(done, total),
            done,
            total,
            cancellationToken);

    private async Task WriteProgressAsync(
        Video video,
        int progressPercent,
        string currentStep,
        int? gridDone,
        int? gridTotal,
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
            session.ProcessingStartedAtUtc ??= now;

            session.EstimatedRemainingSeconds = ProcessingEta.EstimateRemainingSeconds(
                session.ProgressPercent,
                session.ProcessingStartedAtUtc,
                now,
                gridDone,
                gridTotal);
        }

        video.UpdatedAtUtc = now;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task CompleteSessionsAsync(Video video, bool succeeded, CancellationToken cancellationToken) {
        var completedAt = DateTime.UtcNow;
        video.UpdatedAtUtc = completedAt;

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Processing or UploadSessionStatus.Uploaded)) {
            session.Status = succeeded ? UploadSessionStatus.Completed : UploadSessionStatus.Failed;
            session.ProgressPercent = succeeded ? 100 : session.ProgressPercent;
            session.CurrentStep = succeeded ? null : session.CurrentStep;
            session.EstimatedRemainingSeconds = null;
            session.CompletedAtUtc = completedAt;
            session.UpdatedAtUtc = completedAt;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string? Combine(string? existing, string? addition) {
        if (string.IsNullOrEmpty(addition)) {
            return existing;
        }

        return string.IsNullOrEmpty(existing) ? addition : $"{existing}; {addition}";
    }
}
