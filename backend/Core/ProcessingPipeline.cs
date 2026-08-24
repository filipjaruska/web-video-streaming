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
    private readonly LadderComparison _ladderComparison;
    private readonly TuningComparison _tuningComparison;
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
        LadderComparison ladderComparison,
        TuningComparison tuningComparison,
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
        _ladderComparison = ladderComparison;
        _tuningComparison = tuningComparison;
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

        // Must run before anything reads the source: it rewrites the file in place, and every
        // later step (probe, SI/TI, VMAF reference, packaging) should see the normalized copy.
        await NormalizeSourceAsync(video, sourcePath, cancellationToken);

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

            var derived = await RunDerivedLaddersAsync(
                video,
                sourcePath,
                staticPackage.Transcode.Id,
                cancellationToken);

            dynamicTranscodeId = derived.AnimationTranscodeId ?? derived.DynamicTranscodeId;
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

    // —— Source normalization ——————————————————————————————————————————————

    /// <summary>
    /// Rewrites the upload as a faststart MP4 so the browser can play it progressively. The video
    /// and audio bitstreams are copied, so this changes no measurement downstream.
    /// </summary>
    private async Task NormalizeSourceAsync(Video video, string sourcePath, CancellationToken cancellationToken) {
        if (!await _transcoder.NormalizeSourceAsync(sourcePath, cancellationToken)) {
            _logger.LogWarning(
                "Source for {RouteId} could not be normalized to MP4; progressive playback may not work",
                video.RouteId);
            return;
        }

        // The stored type describes what is on disk, not what was uploaded — the httprange
        // endpoint serves this header, and it must now say MP4.
        video.SourceContentType = "video/mp4";
        video.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
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

                return StepOutcome.Ok([result.Section], new AnalysisSeriesDocument {
                    Siti = result.Series,
                    DuplicateFrameShare = SitiAnalyzer.DuplicateFrameShare(result.Series)
                });
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

    // —— Derived ladders ———————————————————————————————————————————————————

    /// <summary>Steps and settings that distinguish one derived-ladder pass from another.</summary>
    private sealed record DerivedLadderPass(
        LadderKind Kind,
        LadderDerivationOptions Options,
        PipelineStep GridStep,
        PipelineStep DeriveStep,
        PipelineStep HlsStep,
        PipelineStep DashStep,
        PipelineStep SitiStep,
        PipelineStep VmafStep,
        string GridSectionId,
        double CambiPenaltyWeight);

    private static readonly DerivedLadderPass DynamicPass = new(
        LadderKind.Dynamic, LadderDerivationOptions.Dynamic,
        PipelineStep.EncodeGrid, PipelineStep.DeriveLadder,
        PipelineStep.DynamicHls, PipelineStep.DynamicDash,
        PipelineStep.DynamicSiti, PipelineStep.DynamicVmaf,
        "encodeGrid", 0);

    private static readonly DerivedLadderPass AnimationPass = new(
        LadderKind.AnimationTuned, LadderDerivationOptions.Animation,
        PipelineStep.AnimationGrid, PipelineStep.AnimationDeriveLadder,
        PipelineStep.AnimationHls, PipelineStep.AnimationDash,
        PipelineStep.AnimationSiti, PipelineStep.AnimationVmaf,
        "encodeGridAnimation", LadderDerivationOptions.Animation.CambiPenaltyWeight);

    /// <summary>
    /// Builds the representative excerpt once, then runs each derived ladder over it: sweep the
    /// grid, derive, package, verify. Finally compares the codec tunings and every ladder against
    /// the static baseline.
    /// </summary>
    /// <remarks>
    /// The excerpt is built here rather than inside each pass on purpose. Both grids must score
    /// against the identical file for their matched (resolution, CRF) samples to isolate the
    /// encoder settings — that pairing is the entire basis of the tuning comparison — and building
    /// it once also avoids paying for a lossless re-cut twice.
    /// Entirely soft-fail: the static ladder is already serving, so anything here that goes wrong
    /// is logged and the run still counts as a success.
    /// </remarks>
    private async Task<DerivedLadderOutcome> RunDerivedLaddersAsync(
        Video video,
        string sourcePath,
        Guid staticTranscodeId,
        CancellationToken cancellationToken) {
        Guid? dynamicId = null;
        Guid? animationId = null;

        try {
            var (dynamicPackage, baseGrid) = await RunPassAsync(
                video, sourcePath, staticTranscodeId, DynamicPass, cancellationToken);
            dynamicId = dynamicPackage?.Transcode.Id;

            var (animationPackage, tunedGrid) = await RunPassAsync(
                video, sourcePath, staticTranscodeId, AnimationPass, cancellationToken);
            animationId = animationPackage?.Transcode.Id;

            if (baseGrid != null && tunedGrid != null) {
                await ReportAsync(video, PipelineStep.TuningComparison, cancellationToken);
                await _tuningComparison.CompareAsync(
                    staticTranscodeId, baseGrid, tunedGrid, AnimationPass.Options.Recipe, cancellationToken);
            }

            // Best available ladder serves: animation, then dynamic, then the static already set.
            var active = animationPackage?.Succeeded == true ? animationPackage
                : dynamicPackage?.Succeeded == true ? dynamicPackage
                : null;

            if (active != null) {
                video.ActiveTranscodeId = active.Transcode.Id;
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            var candidates = new List<(LadderKind, Guid)>();
            if (dynamicPackage?.Succeeded == true) {
                candidates.Add((LadderKind.Dynamic, dynamicPackage.Transcode.Id));
            }

            if (animationPackage?.Succeeded == true) {
                candidates.Add((LadderKind.AnimationTuned, animationPackage.Transcode.Id));
            }

            if (candidates.Count > 0) {
                await ReportAsync(video, PipelineStep.LadderComparison, cancellationToken);
                await _ladderComparison.CompareAsync(staticTranscodeId, candidates, cancellationToken);
            }

            return new DerivedLadderOutcome(dynamicId, animationId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Derived ladder path failed for {RouteId}", video.RouteId);
            return new DerivedLadderOutcome(dynamicId, animationId);
        }
    }

    private sealed record DerivedLadderOutcome(Guid? DynamicTranscodeId, Guid? AnimationTranscodeId);

    /// <summary>Grid, derivation and packaging for one ladder. Returns null on any soft failure.</summary>
    private async Task<(PackageResult? Package, List<EncodeGridPoint>? Grid)> RunPassAsync(
        Video video,
        string sourcePath,
        Guid staticTranscodeId,
        DerivedLadderPass pass,
        CancellationToken cancellationToken) {
        await ReportAsync(video, pass.GridStep, cancellationToken);

        var grid = await _encodeGrid.RunAsync(
            video.RouteId,
            staticTranscodeId,
            sourcePath,
            pass.Options.Recipe,
            pass.CambiPenaltyWeight,
            pass.GridSectionId,
            onProgress: (done, total, ct) => ReportGridAsync(video, done, total, pass.GridStep, ct),
            cancellationToken);

        if (!grid.Success) {
            _logger.LogWarning(
                "{Ladder} encode grid failed for {RouteId}: {Error}",
                pass.Kind, video.RouteId, grid.ErrorMessage);
            return (null, null);
        }

        await ReportAsync(video, pass.DeriveStep, cancellationToken);
        var derived = await _ladderDerivation.DeriveAsync(
            staticTranscodeId,
            grid.Points,
            pass.Options,
            cancellationToken);

        if (!derived.Success || derived.Profile == null) {
            _logger.LogWarning(
                "{Ladder} derivation failed for {RouteId}: {Error}",
                pass.Kind, video.RouteId, derived.ErrorMessage);
            return (null, grid.Points);
        }

        var package = await PackageAndAnalyzeAsync(
            video,
            sourcePath,
            pass.Kind,
            derived.Profile,
            derivedFrom: staticTranscodeId,
            pass.HlsStep,
            pass.DashStep,
            pass.SitiStep,
            pass.VmafStep,
            cancellationToken);

        if (!package.Succeeded) {
            _logger.LogWarning(
                "{Ladder} packaging failed for {RouteId}: {Error}",
                pass.Kind, video.RouteId, package.ErrorMessage);
        }

        return (package, grid.Points);
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

    private Task ReportGridAsync(
        Video video,
        int done,
        int total,
        PipelineStep step,
        CancellationToken cancellationToken) =>
        WriteProgressAsync(
            video,
            ProcessingEta.GridPercent(done, total, step),
            ProcessingEta.GridLabel(done, total, step),
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
