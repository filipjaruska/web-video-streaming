using System.Globalization;
using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Analysis;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

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
/// Post-upload pipeline: source analysis and the shared audio track, then the static ladder, then
/// for each derived ladder an encode grid, crossover derivation, and a packaging pass of its own.
/// </summary>
/// <remarks>
/// Every packaging pass encodes each rung once and stream-copies it into both HLS and DASH, then
/// verifies and scores the rungs once — see <see cref="Transcoder"/> and
/// <see cref="TranscodeAnalysisCollector"/>.
/// </remarks>
public sealed class ProcessingPipeline {
    private readonly AppDbContext _dbContext;
    private readonly MediaPaths _paths;
    private readonly Transcoder _transcoder;
    private readonly MediaProbe _probe;
    private readonly SitiAnalyzer _siti;
    private readonly VmafAnalyzer _vmaf;
    private readonly SubtitleExtractor _subtitles;
    private readonly AnalysisStore _analysis;
    private readonly TranscodeAnalysisCollector _collector;
    private readonly EncodeGrid _encodeGrid;
    private readonly LadderDerivation _ladderDerivation;
    private readonly LadderComparison _ladderComparison;
    private readonly TuningComparison _tuningComparison;
    private readonly ILogger<ProcessingPipeline> _logger;

    /// <summary>Per run. The pipeline is scoped, so one instance serves one run at a time.</summary>
    private ProcessingEtaTracker _eta = new();

    public ProcessingPipeline(
        AppDbContext dbContext,
        MediaPaths paths,
        Transcoder transcoder,
        MediaProbe probe,
        SitiAnalyzer siti,
        VmafAnalyzer vmaf,
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
        _vmaf = vmaf;
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

        _eta = new ProcessingEtaTracker(await LoadEtaPriorAsync(video.Id, cancellationToken));

        try {
            await ReportAsync(video, PipelineStep.Starting, cancellationToken);

            // Subtitles have to be lifted out first. Normalization maps only video and audio and passes
            // -sn, then overwrites the source in place, so any subtitle stream not taken before it runs
            // is gone for good — and MP4 cannot carry the text codecs anyway, which is why the tracks
            // are served as separate WebVTT side-cars.
            await ExtractSubtitlesAsync(video, sourcePath, cancellationToken);

            // Must run before anything measures the source: it rewrites the file in place, and every
            // later step (probe, SI/TI, VMAF reference, packaging) should see the normalized copy.
            await NormalizeSourceAsync(video, sourcePath, cancellationToken);

            var facts = await ReadSourceFactsAsync(sourcePath, cancellationToken);
            _eta.SetWorkload(facts.Frames, (long)facts.Width * facts.Height);

            var error = await RunSourceAnalysisAsync(video, sourcePath, facts, cancellationToken);

            await ReportAsync(video, PipelineStep.AudioEncode, cancellationToken);
            var audio = await EncodeSharedAudioAsync(video, sourcePath, cancellationToken);

            var staticPackage = await PackageAndAnalyzeAsync(
                video,
                sourcePath,
                LadderKind.Static,
                TranscodeProfile.Default,
                derivedFrom: null,
                StaticSteps,
                audio,
                facts,
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
                    audio,
                    facts,
                    cancellationToken);

                dynamicTranscodeId = derived.AnimationTranscodeId ?? derived.DynamicTranscodeId;
            }

            _eta.Finish(DateTime.UtcNow);
            await CompleteSessionsAsync(video, staticPackage.Succeeded, cancellationToken);

            return new ProcessingResult {
                Success = staticPackage.Succeeded,
                TranscodeId = staticPackage.Transcode.Id,
                DynamicTranscodeId = dynamicTranscodeId,
                ErrorMessage = error,
                HasHls = staticPackage.HasHls,
                HasDash = staticPackage.HasDash
            };
        } finally {
            _eta.Finish(DateTime.UtcNow);
            await PersistStageTimingsAsync(video);
        }
    }

    // —— Source facts ——————————————————————————————————————————————————————

    /// <summary>What the rest of the run is sized by: the time estimate's workload and the encode timeouts.</summary>
    private sealed record SourceFacts(int Width, int Height, double DurationSec, long Frames) {
        public static readonly SourceFacts Unknown = new(0, 0, 0, 0);
    }

    private async Task<SourceFacts> ReadSourceFactsAsync(string sourcePath, CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return SourceFacts.Unknown;
        }

        using (probe.ProbeData) {
            var root = probe.ProbeData.RootElement;
            MediaFormatting.TryGetVideoResolution(probe.ProbeData, out var width, out var height);

            var duration = root.TryGetProperty("format", out var format)
                ? MediaFormatting.GetDouble(format, "duration") ?? 0
                : 0;

            long frames = 0;
            if (root.TryGetProperty("streams", out var streams)) {
                foreach (var stream in streams.EnumerateArray()) {
                    if (MediaFormatting.GetString(stream, "codec_type") != "video") {
                        continue;
                    }

                    frames = MediaFormatting.GetLong(stream, "nb_frames") ?? 0;
                    if (frames <= 0 && ParseRate(MediaFormatting.GetString(stream, "avg_frame_rate")) is { } rate) {
                        frames = (long)Math.Round(duration * rate);
                    }

                    break;
                }
            }

            return new SourceFacts(width, height, duration, frames);
        }
    }

    private static double? ParseRate(string? rate) {
        var parts = rate?.Split('/');
        if (parts is not { Length: 2 } ||
            !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var numerator) ||
            !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var denominator) ||
            denominator <= 0) {
            return null;
        }

        return numerator / denominator;
    }

    /// <summary>Per-pass encode timeout: generous, and proportional to the source so long uploads are not cut off.</summary>
    private static TimeSpan PassTimeout(SourceFacts facts) =>
        TimeSpan.FromMinutes(10) + TimeSpan.FromSeconds(Math.Max(facts.DurationSec, 60) * 12);

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

    /// <summary>
    /// Pulls every soft text subtitle track out to a WebVTT side-car, before normalization strips
    /// the streams. Soft-fails like the other source steps, so a video with unreadable subtitles
    /// still processes.
    /// </summary>
    private async Task ExtractSubtitlesAsync(Video video, string sourcePath, CancellationToken cancellationToken) {
        await ReportAsync(video, PipelineStep.Subtitles, cancellationToken);
        await RunSourceStepAsync(video, "subtitles", "Subtitles", "ffmpeg-webvtt", async ct => {
            var result = await _subtitles.ExtractAsync(video.RouteId, sourcePath, ct);
            var sections = result.Section != null ? new List<AnalysisTreeNode> { result.Section } : null;
            return result.Success
                ? StepOutcome.Ok(sections)
                : StepOutcome.Failed(result.ErrorMessage ?? "Subtitle extraction failed", sections);
        }, cancellationToken);
    }

    private async Task<string?> RunSourceAnalysisAsync(
        Video video,
        string sourcePath,
        SourceFacts facts,
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

            await ReportAsync(video, PipelineStep.SourceCambi, cancellationToken);
            await RunSourceStepAsync(
                video,
                "cambi",
                "Banding (CAMBI)",
                "ffmpeg-libvmaf",
                ct => MeasureSourceCambiAsync(sourcePath, facts, ct),
                cancellationToken);

            await ReportAsync(video, PipelineStep.Thumbnail, cancellationToken);
            await ExtractThumbnailAsync(video, sourcePath, cancellationToken);

            return null;
        } catch (Exception ex) {
            _logger.LogError(ex, "Source analysis failed for video {VideoId}", video.Id);
            return ex.Message;
        }
    }

    /// <summary>
    /// CAMBI of the source scored against itself. CAMBI is no-reference, so this is the banding the
    /// encoder was handed — the baseline without which a rendition's CAMBI cannot say how much
    /// banding compression added.
    /// </summary>
    private async Task<StepOutcome> MeasureSourceCambiAsync(string sourcePath, SourceFacts facts, CancellationToken cancellationToken) {
        if (facts.Width <= 0 || facts.Height <= 0) {
            return StepOutcome.Failed("Source resolution unknown");
        }

        var result = await _vmaf.AnalyzeAsync(
            new VmafRequest {
                ReferencePath = sourcePath,
                DistortedPath = sourcePath,
                ReferenceWidth = facts.Width,
                ReferenceHeight = facts.Height,
                DistortedWidth = facts.Width,
                DistortedHeight = facts.Height,
                Models = [VmafAnalyzer.DefaultModels[0]]
            },
            cancellationToken);

        var summary = result.Series?.Summary;
        if (!result.Success || summary?.Cambi is not { } cambi) {
            return StepOutcome.Failed(result.ErrorMessage ?? "libvmaf returned no CAMBI score (needs libvmaf 2.x)");
        }

        var section = Section("cambi", "Banding (CAMBI)", "ffmpeg-libvmaf", AnalysisSectionStatus.Completed, children: [
            StatLeaf("cambi.mean", "Mean CAMBI", cambi),
            summary.CambiMax is { } max ? StatLeaf("cambi.max", "Max CAMBI", max) : Leaf("cambi.max", "Max CAMBI", "—"),
            Leaf("cambi.reading", "Reading", "Banding already present in the source, 0 = none. Each rendition's CAMBI is read against this floor.")
        ]);

        return StepOutcome.Ok([section], new AnalysisSeriesDocument {
            SourceCambi = cambi,
            SourceCambiMax = summary.CambiMax
        });
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

    // —— Shared audio —————————————————————————————————————————————————————

    /// <summary>
    /// The audio track every ladder and both formats share, with its measured rate for the manifests.
    /// Null when the source has no audio — or when encoding it failed, in which case the ladders
    /// still package, silently, rather than failing the whole run.
    /// </summary>
    private async Task<EncodedAudio?> EncodeSharedAudioAsync(Video video, string sourcePath, CancellationToken cancellationToken) {
        var profile = TranscodeProfile.Default;
        var path = _paths.SharedAudioFile(video.RouteId);
        var result = await _transcoder.EncodeAudioAsync(sourcePath, path, profile.AudioBitrate, cancellationToken);

        if (!result.Success) {
            _logger.LogError("Audio encode failed for {RouteId}; packaging without audio: {Error}", video.RouteId, result.ErrorMessage);
            return null;
        }

        if (!result.HasAudio) {
            return null;
        }

        var rate = await MediaFormatting.MeasureStreamRateAsync(_probe, path, "a:0", cancellationToken, profile.SegmentDurationSeconds);
        var nominal = TranscodeProfile.ParseBitrateKbps(profile.AudioBitrate) * 1000L;

        return new EncodedAudio(
            path,
            rate is { AverageBps: > 0 } ? rate.AverageBps : nominal,
            rate is { PeakSegmentBps: > 0 } ? rate.PeakSegmentBps : nominal);
    }

    // —— Packaging ————————————————————————————————————————————————————————

    /// <summary>The four progress steps one ladder's packaging pass reports.</summary>
    private sealed record LadderSteps(PipelineStep Encode, PipelineStep Package, PipelineStep Siti, PipelineStep Vmaf);

    private static readonly LadderSteps StaticSteps = new(
        PipelineStep.StaticEncode, PipelineStep.StaticPackage, PipelineStep.StaticSiti, PipelineStep.StaticVmaf);

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
        LadderSteps steps,
        EncodedAudio? audio,
        SourceFacts facts,
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
            await ReportAsync(video, steps.Encode, cancellationToken);
            var (renditions, encodeError) = await EncodeRenditionsAsync(
                video, transcode.Id, sourcePath, profile, steps.Encode, facts, cancellationToken);
            error = Combine(error, encodeError);

            if (renditions.Count > 0) {
                await ReportAsync(video, steps.Package, cancellationToken);

                var hls = await _transcoder.PackageHlsAsync(
                    renditions, audio, _paths.HlsDir(video.RouteId, transcode.Id), profile, cancellationToken);
                hasHls = hls.Success;
                error = Combine(error, hls.ErrorMessage);

                var dash = await _transcoder.PackageDashAsync(
                    renditions, audio, _paths.DashDir(video.RouteId, transcode.Id), profile, cancellationToken);
                hasDash = dash.Success;
                error = Combine(error, dash.ErrorMessage);
            }

            if (hasHls || hasDash) {
                await ReportAsync(video, steps.Siti, cancellationToken);
                await _collector.CollectAsync(video.RouteId, transcode.Id, hasHls, hasDash, profile, cancellationToken);

                await ReportAsync(video, steps.Vmaf, cancellationToken);
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

    /// <summary>
    /// Encodes the ladder's rungs one after another — x264 already saturates every core, so running
    /// them in parallel only makes them contend — measuring each as it lands.
    /// </summary>
    private async Task<(List<EncodedRendition> Encoded, string? Error)> EncodeRenditionsAsync(
        Video video,
        Guid transcodeId,
        string sourcePath,
        TranscodeProfile profile,
        PipelineStep step,
        SourceFacts facts,
        CancellationToken cancellationToken) {
        var encoded = new List<EncodedRendition>();
        string? error = null;
        var timeout = PassTimeout(facts);
        var total = profile.Variants.Count;

        for (var i = 0; i < total; i++) {
            await ReportSubAsync(video, step, i, total, cancellationToken);

            var variant = profile.Variants[i];
            var output = _paths.RenditionFile(video.RouteId, transcodeId, variant.Label);
            var result = await _transcoder.EncodeRenditionAsync(
                sourcePath,
                output,
                _paths.WorkDir(video.RouteId, transcodeId, variant.Label),
                variant,
                profile,
                timeout,
                cancellationToken);

            if (!result.Success) {
                _logger.LogWarning("Rendition {Label} failed for {RouteId}: {Error}", variant.Label, video.RouteId, result.ErrorMessage);
                error = Combine(error, result.ErrorMessage);
                continue;
            }

            var rate = await MediaFormatting.MeasureVideoRateAsync(_probe, output, cancellationToken, profile.SegmentDurationSeconds);
            encoded.Add(new EncodedRendition(variant, output, rate));

            _logger.LogInformation(
                "Encoded {Label} for {RouteId}: target {Target}, measured {Average} average / {Peak} peak segment",
                variant.Label,
                video.RouteId,
                variant.Bitrate,
                MediaFormatting.FormatBitrate(rate?.AverageBps),
                MediaFormatting.FormatBitrate(rate?.PeakSegmentBps));
        }

        await ReportSubAsync(video, step, total, total, cancellationToken);
        TryDeleteDirectory(_paths.WorkRoot(video.RouteId, transcodeId));

        return (encoded, error);
    }

    // —— Derived ladders ———————————————————————————————————————————————————

    /// <summary>Steps and settings that distinguish one derived-ladder pass from another.</summary>
    private sealed record DerivedLadderPass(
        LadderKind Kind,
        LadderDerivationOptions Options,
        PipelineStep GridStep,
        PipelineStep DeriveStep,
        LadderSteps Steps,
        string GridSectionId,
        double CambiPenaltyWeight);

    private static readonly DerivedLadderPass DynamicPass = new(
        LadderKind.Dynamic, LadderDerivationOptions.Dynamic,
        PipelineStep.EncodeGrid, PipelineStep.DeriveLadder,
        new LadderSteps(PipelineStep.DynamicEncode, PipelineStep.DynamicPackage, PipelineStep.DynamicSiti, PipelineStep.DynamicVmaf),
        "encodeGrid", 0);

    private static readonly DerivedLadderPass AnimationPass = new(
        LadderKind.AnimationTuned, LadderDerivationOptions.Animation,
        PipelineStep.AnimationGrid, PipelineStep.AnimationDeriveLadder,
        new LadderSteps(PipelineStep.AnimationEncode, PipelineStep.AnimationPackage, PipelineStep.AnimationSiti, PipelineStep.AnimationVmaf),
        "encodeGridAnimation", LadderDerivationOptions.Animation.CambiPenaltyWeight);

    /// <summary>
    /// Runs each derived ladder over the full source: sweep the grid, derive, package, verify. Then
    /// compares the codec tunings and every ladder against the static baseline.
    /// </summary>
    /// <remarks>
    /// Both grids score against the identical source, so their matched (resolution, CRF) samples
    /// isolate the encoder settings — that pairing is the entire basis of the tuning comparison.
    /// Entirely soft-fail: the static ladder is already serving, so anything here that goes wrong
    /// is logged and the run still counts as a success.
    /// </remarks>
    private async Task<DerivedLadderOutcome> RunDerivedLaddersAsync(
        Video video,
        string sourcePath,
        Guid staticTranscodeId,
        EncodedAudio? audio,
        SourceFacts facts,
        CancellationToken cancellationToken) {
        Guid? dynamicId = null;
        Guid? animationId = null;

        try {
            var (dynamicPackage, baseGrid) = await RunPassAsync(
                video, sourcePath, staticTranscodeId, DynamicPass, audio, facts, cancellationToken);
            dynamicId = dynamicPackage?.Transcode.Id;

            var (animationPackage, tunedGrid) = await RunPassAsync(
                video, sourcePath, staticTranscodeId, AnimationPass, audio, facts, cancellationToken);
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
        EncodedAudio? audio,
        SourceFacts facts,
        CancellationToken cancellationToken) {
        await ReportAsync(video, pass.GridStep, cancellationToken);

        var grid = await _encodeGrid.RunAsync(
            video.RouteId,
            staticTranscodeId,
            sourcePath,
            pass.Options.Recipe,
            pass.CambiPenaltyWeight,
            pass.GridSectionId,
            onProgress: (done, total, ct) => ReportSubAsync(video, pass.GridStep, done, total, ct),
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
            pass.Steps,
            audio,
            facts,
            cancellationToken);

        if (!package.Succeeded) {
            _logger.LogWarning(
                "{Ladder} packaging failed for {RouteId}: {Error}",
                pass.Kind, video.RouteId, package.ErrorMessage);
        }

        return (package, grid.Points);
    }

    // —— Session progress ——————————————————————————————————————————————————

    private Task ReportAsync(Video video, PipelineStep step, CancellationToken cancellationToken) {
        _eta.Begin(step, DateTime.UtcNow);
        return WriteProgressAsync(video, ProcessingEta.PercentFor(step), ProcessingEta.LabelFor(step), cancellationToken);
    }

    /// <summary>Progress inside a step — grid samples or encoded rungs.</summary>
    private Task ReportSubAsync(Video video, PipelineStep step, int done, int total, CancellationToken cancellationToken) {
        _eta.Begin(step, DateTime.UtcNow);
        _eta.Progress(done, total);
        return WriteProgressAsync(
            video,
            ProcessingEta.SubPercent(step, done, total),
            ProcessingEta.SubLabel(step, done, total),
            cancellationToken);
    }

    private async Task WriteProgressAsync(
        Video video,
        int progressPercent,
        string currentStep,
        CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;
        var remaining = _eta.EstimateRemainingSeconds(now);

        foreach (var session in video.UploadSessions.Where(session =>
                     session.Status is UploadSessionStatus.Uploaded
                         or UploadSessionStatus.Processing
                         or UploadSessionStatus.Uploading)) {
            session.Status = UploadSessionStatus.Processing;
            session.ProgressPercent = Math.Max(session.ProgressPercent, progressPercent);
            session.CurrentStep = currentStep;
            session.UpdatedAtUtc = now;
            session.ProcessingStartedAtUtc ??= now;
            session.EstimatedRemainingSeconds = remaining;
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

    // —— Time estimate prior ——————————————————————————————————————————————

    /// <summary>Stage timings of the most recent completed run on this machine, or null for the built-in defaults.</summary>
    private async Task<IReadOnlyDictionary<string, StageTiming>?> LoadEtaPriorAsync(Guid currentVideoId, CancellationToken cancellationToken) {
        try {
            var recent = await _dbContext.UploadSessions
                .Where(session =>
                    session.Status == UploadSessionStatus.Completed &&
                    session.VideoId != currentVideoId &&
                    session.CompletedAtUtc != null)
                .OrderByDescending(session => session.CompletedAtUtc)
                .Select(session => session.VideoId)
                .Take(10)
                .ToListAsync(cancellationToken);

            foreach (var videoId in recent.Distinct()) {
                var stored = await _analysis.TryGetAsync(AnalysisOwner.Source, videoId, cancellationToken);
                if (stored?.Series.StageTimings is { Count: > 0 } timings) {
                    return timings;
                }
            }
        } catch (Exception ex) {
            _logger.LogDebug(ex, "No time-estimate prior available; using defaults");
        }

        return null;
    }

    private async Task PersistStageTimingsAsync(Video video) {
        try {
            var timings = _eta.Timings();
            if (timings.Count == 0) {
                return;
            }

            await _analysis.MergeSeriesAsync(
                AnalysisOwner.Source,
                video.Id,
                new AnalysisSeriesDocument { StageTimings = timings },
                CancellationToken.None);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Could not store stage timings for {RouteId}", video.RouteId);
        }
    }

    private void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path)) {
                Directory.Delete(path, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogDebug(ex, "Could not remove {Path}", path);
        }
    }

    private static string? Combine(string? existing, string? addition) {
        if (string.IsNullOrEmpty(addition)) {
            return existing;
        }

        return string.IsNullOrEmpty(existing) ? addition : $"{existing}; {addition}";
    }
}
