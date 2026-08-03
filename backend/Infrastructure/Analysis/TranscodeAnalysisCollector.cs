using System.Globalization;
using System.Text.Json;
using System.Xml.Linq;
using WebWVideoStreamingAPI.Core;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public interface ITranscodeAnalysisCollector {
    Task CollectAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Scores each HLS/DASH rung with full-reference VMAF vs source (upload pipeline step).
    /// </summary>
    Task CollectVmafAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        CancellationToken cancellationToken = default);
}

public sealed class TranscodeAnalysisCollector : ITranscodeAnalysisCollector {
    private readonly IVideoStorageService _storage;
    private readonly IMediaProbeService _mediaProbe;
    private readonly ISitiAnalysisService _sitiAnalysis;
    private readonly IVmafAnalysisService _vmafAnalysis;
    private readonly IFfmpegRunner _ffmpeg;
    private readonly IVideoTranscodeAnalysisService _analysis;
    private readonly ILogger<TranscodeAnalysisCollector> _logger;

    public TranscodeAnalysisCollector(
        IVideoStorageService storage,
        IMediaProbeService mediaProbe,
        ISitiAnalysisService sitiAnalysis,
        IVmafAnalysisService vmafAnalysis,
        IFfmpegRunner ffmpeg,
        IVideoTranscodeAnalysisService analysis,
        ILogger<TranscodeAnalysisCollector> logger) {
        _storage = storage;
        _mediaProbe = mediaProbe;
        _sitiAnalysis = sitiAnalysis;
        _vmafAnalysis = vmafAnalysis;
        _ffmpeg = ffmpeg;
        _analysis = analysis;
        _logger = logger;
    }

    public async Task CollectAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        CancellationToken cancellationToken = default) {
        var profile = TranscodeProfile.Default;
        var sitiByFormat = new FormatSitiSeriesDocument();
        var reference = await ResolveReferenceAsync(routeId, cancellationToken);

        if (hasHls) {
            var hlsSiti = new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectHlsAsync(
                routeId,
                transcodeId,
                profile,
                reference,
                hlsSiti,
                vmafByRendition: null,
                runSiti: true,
                runVmaf: false,
                cancellationToken);
            if (hlsSiti.Count > 0) {
                sitiByFormat.Hls = hlsSiti;
            }
        } else {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                FormatPendingSection("hls", "HLS", "HLS not produced for this packaging run"),
                cancellationToken);
        }

        if (hasDash) {
            var dashSiti = new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectDashAsync(
                routeId,
                transcodeId,
                profile,
                reference,
                dashSiti,
                vmafByRendition: null,
                runSiti: true,
                runVmaf: false,
                cancellationToken);
            if (dashSiti.Count > 0) {
                sitiByFormat.Dash = dashSiti;
            }
        } else {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                FormatPendingSection("dash", "DASH", "DASH not produced for this packaging run"),
                cancellationToken);
        }

        await PersistSeriesAsync(transcodeId, sitiByFormat, vmafByFormat: null, cancellationToken);
    }

    public async Task CollectVmafAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        CancellationToken cancellationToken = default) {
        var profile = TranscodeProfile.Default;
        var vmafByFormat = new FormatVmafSeriesDocument();
        var reference = await ResolveReferenceAsync(routeId, cancellationToken);

        if (hasHls) {
            var hlsVmaf = new Dictionary<string, VmafSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectHlsAsync(
                routeId,
                transcodeId,
                profile,
                reference,
                sitiByRendition: null,
                vmafByRendition: hlsVmaf,
                runSiti: false,
                runVmaf: true,
                cancellationToken);
            if (hlsVmaf.Count > 0) {
                vmafByFormat.Hls = hlsVmaf;
            }
        }

        if (hasDash) {
            var dashVmaf = new Dictionary<string, VmafSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectDashAsync(
                routeId,
                transcodeId,
                profile,
                reference,
                sitiByRendition: null,
                vmafByRendition: dashVmaf,
                runSiti: false,
                runVmaf: true,
                cancellationToken);
            if (dashVmaf.Count > 0) {
                vmafByFormat.Dash = dashVmaf;
            }
        }

        await _analysis.SetSeriesAsync(
            transcodeId,
            new AnalysisSeriesDocument { VmafByFormat = vmafByFormat },
            cancellationToken);
    }

    private async Task PersistSeriesAsync(
        Guid transcodeId,
        FormatSitiSeriesDocument? sitiByFormat,
        FormatVmafSeriesDocument? vmafByFormat,
        CancellationToken cancellationToken) {
        var hasSiti = sitiByFormat is { Hls: not null } or { Dash: not null };
        var hasVmaf = vmafByFormat is { Hls: not null } or { Dash: not null };
        if (!hasSiti && !hasVmaf) {
            return;
        }

        await _analysis.SetSeriesAsync(
            transcodeId,
            new AnalysisSeriesDocument {
                SitiByFormat = hasSiti ? sitiByFormat : null,
                VmafByFormat = hasVmaf ? vmafByFormat : null
            },
            cancellationToken);
    }

    private async Task CollectHlsAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        ReferenceVideoInfo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        if (runSiti) {
            await _analysis.MarkSectionRunningAsync(
                transcodeId,
                "hls",
                "HLS",
                "ffprobe-transcode",
                cancellationToken);
        }

        try {
            var hlsDir = _storage.GetHlsDir(routeId, transcodeId);
            var sitiAverages = new Dictionary<string, (double AvgSi, double AvgTi)>(StringComparer.OrdinalIgnoreCase);
            var vmafSummaries = new Dictionary<string, VmafSummary>(StringComparer.OrdinalIgnoreCase);
            var children = new List<AnalysisTreeNode> {
                BuildHlsGeneralSection(profile, hlsDir)
            };

            foreach (var variant in profile.Variants) {
                var playlistPath = Path.Combine(hlsDir, $"{variant.Label}.m3u8");
                if (runSiti) {
                    children.Add(await BuildHlsVariantSectionAsync(variant, playlistPath, profile, cancellationToken));
                }

                await AnalyzeHlsRenditionAsync(
                    playlistPath,
                    variant,
                    reference,
                    sitiByRendition,
                    vmafByRendition,
                    sitiAverages,
                    vmafSummaries,
                    runSiti,
                    runVmaf,
                    cancellationToken);
            }

            if (runSiti) {
                children.Add(BuildSitiSummarySection("hls.siti", "SI/TI (per rendition)", "hls", sitiAverages, profile));
            }

            var vmafSection = BuildVmafSummarySection("hls.vmaf", "VMAF (per rendition)", "hls", vmafSummaries, profile, runVmaf);
            children.Add(vmafSection);

            if (runSiti) {
                await _analysis.UpsertSectionAsync(
                    transcodeId,
                    CompletedFormatSection("hls", "HLS", children),
                    cancellationToken);
            } else if (runVmaf) {
                await UpsertVmafIntoExistingFormatSectionAsync(
                    transcodeId,
                    "hls",
                    "HLS",
                    vmafSection,
                    cancellationToken);
            }

            _logger.LogInformation("HLS analysis completed for {RouteId}/{TranscodeId}", routeId, transcodeId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "HLS analysis failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
            if (runSiti) {
                await _analysis.MarkSectionFailedAsync(
                    transcodeId,
                    "hls",
                    "HLS",
                    "ffprobe-transcode",
                    ex.Message,
                    cancellationToken);
            }
        }
    }

    private async Task CollectDashAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        ReferenceVideoInfo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        if (runSiti) {
            await _analysis.MarkSectionRunningAsync(
                transcodeId,
                "dash",
                "DASH",
                "ffprobe-transcode",
                cancellationToken);
        }

        try {
            var dashDir = _storage.GetDashDir(routeId, transcodeId);
            var manifestPath = Path.Combine(dashDir, "manifest.mpd");
            var sitiAverages = new Dictionary<string, (double AvgSi, double AvgTi)>(StringComparer.OrdinalIgnoreCase);
            var vmafSummaries = new Dictionary<string, VmafSummary>(StringComparer.OrdinalIgnoreCase);
            var children = new List<AnalysisTreeNode>();

            var reps = ParseDashVideoRepresentations(manifestPath, profile);
            if (runSiti) {
                children.Add(BuildDashGeneralSection(profile, manifestPath, reps));
            }

            foreach (var variant in profile.Variants) {
                var rep = reps.FirstOrDefault(item =>
                    string.Equals(item.Label, variant.Label, StringComparison.OrdinalIgnoreCase));
                if (runSiti) {
                    children.Add(BuildDashVariantSection(variant, profile, rep));
                }

                if (rep == null) {
                    continue;
                }

                await AnalyzeDashRenditionAsync(
                    dashDir,
                    rep.RepresentationId,
                    variant,
                    reference,
                    sitiByRendition,
                    vmafByRendition,
                    sitiAverages,
                    vmafSummaries,
                    runSiti,
                    runVmaf,
                    cancellationToken);
            }

            if (runSiti) {
                children.Add(BuildSitiSummarySection("dash.siti", "SI/TI (per rendition)", "dash", sitiAverages, profile));
            }

            var vmafSection = BuildVmafSummarySection("dash.vmaf", "VMAF (per rendition)", "dash", vmafSummaries, profile, runVmaf);
            children.Add(vmafSection);

            if (runSiti) {
                await _analysis.UpsertSectionAsync(
                    transcodeId,
                    CompletedFormatSection("dash", "DASH", children),
                    cancellationToken);
            } else if (runVmaf) {
                await UpsertVmafIntoExistingFormatSectionAsync(
                    transcodeId,
                    "dash",
                    "DASH",
                    vmafSection,
                    cancellationToken);
            }

            _logger.LogInformation("DASH analysis completed for {RouteId}/{TranscodeId}", routeId, transcodeId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "DASH analysis failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
            if (runSiti) {
                await _analysis.MarkSectionFailedAsync(
                    transcodeId,
                    "dash",
                    "DASH",
                    "ffprobe-transcode",
                    ex.Message,
                    cancellationToken);
            }
        }
    }

    private async Task UpsertVmafIntoExistingFormatSectionAsync(
        Guid transcodeId,
        string formatId,
        string formatLabel,
        AnalysisTreeNode? vmafSection,
        CancellationToken cancellationToken) {
        if (vmafSection == null) {
            return;
        }

        var docs = await _analysis.TryGetDocumentsAsync(transcodeId, cancellationToken);
        if (docs == null) {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                CompletedFormatSection(formatId, formatLabel, [vmafSection]),
                cancellationToken);
            return;
        }

        var tree = docs.Value.Tree;
        var index = tree.Children.FindIndex(node => node.Id == formatId);
        if (index < 0) {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                CompletedFormatSection(formatId, formatLabel, [vmafSection]),
                cancellationToken);
            return;
        }

        var existing = tree.Children[index];
        var children = existing.Children?.ToList() ?? [];
        children.RemoveAll(child => child.Id == vmafSection.Id);
        children.Add(vmafSection);

        await _analysis.UpsertSectionAsync(
            transcodeId,
            CompletedFormatSection(formatId, formatLabel, children),
            cancellationToken);
    }

    private async Task AnalyzeHlsRenditionAsync(
        string playlistPath,
        TranscodeVariant variant,
        ReferenceVideoInfo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        Dictionary<string, (double AvgSi, double AvgTi)> sitiAverages,
        Dictionary<string, VmafSummary> vmafSummaries,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        if (!File.Exists(playlistPath)) {
            _logger.LogWarning("Playlist not found for HLS {Label}", variant.Label);
            return;
        }

        var tempDir = Path.Combine(Path.GetTempPath(), $"transcode-analysis-hls-{Guid.NewGuid():N}");
        var tempMp4 = Path.Combine(tempDir, $"{variant.Label}.mp4");

        try {
            Directory.CreateDirectory(tempDir);
            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            var remux = await _ffmpeg.RunAsync(
                $@"-y -i ""{playlistPath}"" -c copy ""{tempMp4}""",
                workingDirectory: Path.GetDirectoryName(playlistPath),
                timeout: TimeSpan.FromMinutes(10),
                cancellationToken: cancellationToken);

            if (!remux.Success || !File.Exists(tempMp4)) {
                _logger.LogWarning(
                    "Failed to remux HLS {Label}: {Error}",
                    variant.Label,
                    remux.ErrorMessage ?? remux.StdErr);
                return;
            }

            if (runSiti && sitiByRendition != null) {
                var sitiResult = await _sitiAnalysis.AnalyzeAsync(tempMp4, cancellationToken);
                RecordSitiResult(variant.Label, sitiResult, sitiByRendition, sitiAverages);
            }

            if (runVmaf && vmafByRendition != null) {
                await RunVmafForTempAsync(
                    tempMp4,
                    variant,
                    reference,
                    vmafByRendition,
                    vmafSummaries,
                    cancellationToken);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "HLS rendition analysis failed for {Label}", variant.Label);
        } finally {
            TryDeleteDirectory(tempDir);
        }
    }

    private async Task AnalyzeDashRenditionAsync(
        string dashDir,
        string representationId,
        TranscodeVariant variant,
        ReferenceVideoInfo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        Dictionary<string, (double AvgSi, double AvgTi)> sitiAverages,
        Dictionary<string, VmafSummary> vmafSummaries,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        var initPath = Path.Combine(dashDir, $"init-{representationId}.m4s");
        if (!File.Exists(initPath)) {
            _logger.LogWarning("Init segment not found for DASH {Label} (id={Id})", variant.Label, representationId);
            return;
        }

        var chunks = Directory.GetFiles(dashDir, $"chunk-{representationId}-*.m4s")
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (chunks.Count == 0) {
            _logger.LogWarning("No media chunks found for DASH {Label} (id={Id})", variant.Label, representationId);
            return;
        }

        var tempDir = Path.Combine(Path.GetTempPath(), $"transcode-analysis-dash-{Guid.NewGuid():N}");
        var tempMp4 = Path.Combine(tempDir, $"{variant.Label}.mp4");

        try {
            Directory.CreateDirectory(tempDir);

            await using (var output = File.Create(tempMp4)) {
                await CopyFileToAsync(initPath, output, cancellationToken);
                foreach (var chunk in chunks) {
                    await CopyFileToAsync(chunk, output, cancellationToken);
                }
            }

            if (runSiti && sitiByRendition != null) {
                var sitiResult = await _sitiAnalysis.AnalyzeAsync(tempMp4, cancellationToken);
                RecordSitiResult(variant.Label, sitiResult, sitiByRendition, sitiAverages);
            }

            if (runVmaf && vmafByRendition != null) {
                await RunVmafForTempAsync(
                    tempMp4,
                    variant,
                    reference,
                    vmafByRendition,
                    vmafSummaries,
                    cancellationToken);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "DASH rendition analysis failed for {Label}", variant.Label);
        } finally {
            TryDeleteDirectory(tempDir);
        }
    }

    private async Task RunVmafForTempAsync(
        string tempMp4,
        TranscodeVariant variant,
        ReferenceVideoInfo? reference,
        Dictionary<string, VmafSeriesData> vmafByRendition,
        Dictionary<string, VmafSummary> vmafSummaries,
        CancellationToken cancellationToken) {
        if (reference == null) {
            _logger.LogWarning("Skipping VMAF for {Label}: source reference unavailable", variant.Label);
            return;
        }

        ParseVariantResolution(variant.Resolution, out var distW, out var distH);
        var bitrateBps = (long)TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000;

        var result = await _vmafAnalysis.AnalyzeAsync(
            new VmafAnalysisRequest {
                ReferencePath = reference.Path,
                DistortedPath = tempMp4,
                ReferenceWidth = reference.Width,
                ReferenceHeight = reference.Height,
                DistortedWidth = distW,
                DistortedHeight = distH,
                BitrateBps = bitrateBps
            },
            cancellationToken);

        if (!result.Success || result.Series == null) {
            _logger.LogWarning(
                "VMAF failed for {Label}: {Error}",
                variant.Label,
                result.ErrorMessage);
            return;
        }

        vmafByRendition[variant.Label] = result.Series;
        vmafSummaries[variant.Label] = result.Series.Summary;
    }

    private async Task<ReferenceVideoInfo?> ResolveReferenceAsync(
        string routeId,
        CancellationToken cancellationToken) {
        var sourcePath = _storage.ResolveSourcePath(routeId);
        if (sourcePath == null || !File.Exists(sourcePath)) {
            _logger.LogWarning("Source path missing for VMAF reference {RouteId}", routeId);
            return null;
        }

        var probe = await _mediaProbe.ProbeAsync(sourcePath, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            _logger.LogWarning(
                "Failed to probe source for VMAF reference {RouteId}: {Error}",
                routeId,
                probe.ErrorMessage);
            return null;
        }

        using (probe.ProbeData) {
            if (!TryGetVideoResolution(probe.ProbeData, out var width, out var height)) {
                _logger.LogWarning("Could not read source resolution for VMAF {RouteId}", routeId);
                return null;
            }

            return new ReferenceVideoInfo {
                Path = sourcePath,
                Width = width,
                Height = height
            };
        }
    }

    private async Task<AnalysisTreeNode> BuildHlsVariantSectionAsync(
        TranscodeVariant variant,
        string playlistPath,
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        var children = new List<AnalysisTreeNode> {
            Leaf($"hls.{variant.Label}.playlist", "Media playlist", $"hls/{variant.Label}.m3u8"),
            Leaf($"hls.{variant.Label}.target_resolution", "Target resolution", variant.Resolution.Replace(':', 'x')),
            Leaf($"hls.{variant.Label}.target_bitrate", "Target bit rate", FormatTargetBitrate(variant.Bitrate)),
            Leaf(
                $"hls.{variant.Label}.segment",
                "Segment duration",
                $"{profile.SegmentDurationSeconds.ToString("0.###", CultureInfo.InvariantCulture)} s")
        };

        if (!File.Exists(playlistPath)) {
            children.Add(Leaf($"hls.{variant.Label}.error", "Probe error", "Playlist not found"));
            return Section($"hls.{variant.Label}", variant.Label, "ffprobe-transcode", AnalysisSectionStatus.Failed, children);
        }

        var probeResult = await _mediaProbe.ProbeAsync(playlistPath, cancellationToken);
        if (!probeResult.Success || probeResult.ProbeData == null) {
            children.Add(Leaf(
                $"hls.{variant.Label}.error",
                "Probe error",
                probeResult.ErrorMessage ?? "ffprobe failed"));
            children.Add(Leaf($"hls.{variant.Label}.codec", "Codec", $"{profile.VideoCodec} / {profile.AudioCodec}"));
            return Section($"hls.{variant.Label}", variant.Label, "ffprobe-transcode", AnalysisSectionStatus.Failed, children);
        }

        using (probeResult.ProbeData) {
            AppendProbeLeaves(children, $"hls.{variant.Label}", probeResult.ProbeData, profile);
        }

        return Section($"hls.{variant.Label}", variant.Label, "ffprobe-transcode", AnalysisSectionStatus.Completed, children);
    }

    private static AnalysisTreeNode BuildDashVariantSection(
        TranscodeVariant variant,
        TranscodeProfile profile,
        DashRepresentationInfo? rep) {
        var children = new List<AnalysisTreeNode> {
            Leaf($"dash.{variant.Label}.manifest", "Manifest", "dash/manifest.mpd"),
            Leaf($"dash.{variant.Label}.target_resolution", "Target resolution", variant.Resolution.Replace(':', 'x')),
            Leaf($"dash.{variant.Label}.target_bitrate", "Target bit rate", FormatTargetBitrate(variant.Bitrate)),
            Leaf(
                $"dash.{variant.Label}.segment",
                "Segment duration",
                $"{profile.SegmentDurationSeconds.ToString("0.###", CultureInfo.InvariantCulture)} s")
        };

        if (rep == null) {
            children.Add(Leaf($"dash.{variant.Label}.error", "Probe error", "Representation not found in MPD"));
            return Section($"dash.{variant.Label}", variant.Label, "ffprobe-transcode", AnalysisSectionStatus.Failed, children);
        }

        children.Add(Leaf($"dash.{variant.Label}.representation_id", "Representation ID", rep.RepresentationId));
        if (rep.Bandwidth != null) {
            children.Add(Leaf($"dash.{variant.Label}.bandwidth", "Bandwidth", rep.Bandwidth));
        }

        if (rep.Resolution != null) {
            children.Add(Leaf($"dash.{variant.Label}.resolution", "Resolution", rep.Resolution));
        }

        children.Add(Leaf(
            $"dash.{variant.Label}.codec",
            "Codec",
            rep.Codecs ?? $"{profile.VideoCodec} / {profile.AudioCodec}"));

        if (!string.IsNullOrWhiteSpace(rep.InitSegment)) {
            children.Add(Leaf($"dash.{variant.Label}.init", "Init segment", $"dash/{rep.InitSegment}"));
        }

        return Section($"dash.{variant.Label}", variant.Label, "ffprobe-transcode", AnalysisSectionStatus.Completed, children);
    }

    private void TryDeleteDirectory(string tempDir) {
        try {
            if (Directory.Exists(tempDir)) {
                Directory.Delete(tempDir, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to delete temp analysis directory {Path}", tempDir);
        }
    }

    private static async Task CopyFileToAsync(string path, Stream output, CancellationToken cancellationToken) {
        await using var input = File.OpenRead(path);
        await input.CopyToAsync(output, cancellationToken);
    }

    private static void RecordSitiResult(
        string label,
        SitiAnalysisResult sitiResult,
        Dictionary<string, SitiSeriesData> sitiByRendition,
        Dictionary<string, (double AvgSi, double AvgTi)> sitiAverages) {
        if (!sitiResult.Success || sitiResult.Series == null) {
            return;
        }

        sitiByRendition[label] = sitiResult.Series;
        var avgSi = sitiResult.Series.Si.Count > 0 ? sitiResult.Series.Si.Average() : 0;
        var avgTi = sitiResult.Series.Ti.Count > 0 ? sitiResult.Series.Ti.Average() : 0;
        sitiAverages[label] = (avgSi, avgTi);
    }

    private static AnalysisTreeNode BuildHlsGeneralSection(TranscodeProfile profile, string hlsDir) {
        var masterExists = File.Exists(Path.Combine(hlsDir, "master.m3u8"));
        return Section(
            "hls.general",
            "General",
            "ffprobe-transcode",
            AnalysisSectionStatus.Completed,
            [
                Leaf("hls.general.playlist", "Master playlist", "hls/master.m3u8"),
                Leaf("hls.general.format", "Format", "HLS / MPEG-TS"),
                Leaf("hls.general.variants", "Variant count", profile.Variants.Count.ToString(CultureInfo.InvariantCulture)),
                Leaf("hls.general.profile", "Transcode profile", profile.Name),
                Leaf("hls.general.master_present", "Master playlist present", masterExists ? "Yes" : "No")
            ]);
    }

    private static AnalysisTreeNode BuildDashGeneralSection(
        TranscodeProfile profile,
        string manifestPath,
        IReadOnlyList<DashRepresentationInfo> reps) {
        var children = new List<AnalysisTreeNode> {
            Leaf("dash.general.manifest", "Manifest", "dash/manifest.mpd"),
            Leaf("dash.general.format", "Format", "MPEG-DASH / fMP4"),
            Leaf(
                "dash.general.variants",
                "Variant count",
                profile.Variants.Count.ToString(CultureInfo.InvariantCulture)),
            Leaf("dash.general.profile", "Transcode profile", profile.Name),
            Leaf("dash.general.manifest_present", "Manifest present", File.Exists(manifestPath) ? "Yes" : "No"),
            Leaf(
                "dash.general.reps_found",
                "Representations found",
                reps.Count.ToString(CultureInfo.InvariantCulture))
        };

        if (File.Exists(manifestPath)) {
            try {
                var doc = XDocument.Load(manifestPath);
                var profiles = doc.Root?.Attribute("profiles")?.Value;
                if (!string.IsNullOrWhiteSpace(profiles)) {
                    children.Add(Leaf("dash.general.mpd_profiles", "MPD profiles", profiles));
                }
            } catch {
                // Ignore MPD parse errors here; per-rung sections handle missing data.
            }
        }

        return Section("dash.general", "General", "ffprobe-transcode", AnalysisSectionStatus.Completed, children);
    }

    private static List<DashRepresentationInfo> ParseDashVideoRepresentations(
        string manifestPath,
        TranscodeProfile profile) {
        var results = new List<DashRepresentationInfo>();
        if (!File.Exists(manifestPath)) {
            return results;
        }

        var doc = XDocument.Load(manifestPath);
        XNamespace ns = doc.Root?.Name.NamespaceName ?? "urn:mpeg:dash:schema:mpd:2011";

        var videoReps = doc.Descendants(ns + "Representation")
            .Where(rep => {
                var mime = rep.Attribute("mimeType")?.Value ?? "";
                if (mime.StartsWith("video", StringComparison.OrdinalIgnoreCase)) {
                    return true;
                }

                return rep.Attribute("width") != null || rep.Attribute("height") != null;
            })
            .ToList();

        for (var i = 0; i < videoReps.Count; i++) {
            var rep = videoReps[i];
            var width = rep.Attribute("width")?.Value;
            var height = rep.Attribute("height")?.Value;
            var label = MatchVariantLabel(profile, width, height, i);
            var repId = rep.Attribute("id")?.Value ?? i.ToString(CultureInfo.InvariantCulture);

            var template = rep.Element(ns + "SegmentTemplate")
                ?? rep.Parent?.Element(ns + "SegmentTemplate");
            var initTemplate = template?.Attribute("initialization")?.Value;
            var initSegment = initTemplate?.Replace("$RepresentationID$", repId, StringComparison.Ordinal);

            results.Add(new DashRepresentationInfo {
                Label = label,
                RepresentationId = repId,
                Bandwidth = rep.Attribute("bandwidth")?.Value,
                Resolution = width != null && height != null ? $"{width}x{height}" : null,
                Codecs = rep.Attribute("codecs")?.Value,
                InitSegment = initSegment
            });
        }

        return results;
    }

    private static string MatchVariantLabel(
        TranscodeProfile profile,
        string? width,
        string? height,
        int indexFallback) {
        if (height != null &&
            int.TryParse(height, NumberStyles.Integer, CultureInfo.InvariantCulture, out var h)) {
            var byHeight = profile.Variants.FirstOrDefault(variant => {
                var parts = variant.Resolution.Split(':');
                return parts.Length == 2 &&
                       int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var targetH) &&
                       targetH == h;
            });
            if (byHeight != null) {
                return byHeight.Label;
            }
        }

        if (indexFallback >= 0 && indexFallback < profile.Variants.Count) {
            return profile.Variants[indexFallback].Label;
        }

        return width != null && height != null ? $"{height}p" : $"rep{indexFallback}";
    }

    private static void AppendProbeLeaves(
        List<AnalysisTreeNode> children,
        string prefix,
        JsonDocument probeData,
        TranscodeProfile profile) {
        var root = probeData.RootElement;

        if (root.TryGetProperty("format", out var format)) {
            if (format.TryGetProperty("bit_rate", out var bitRate) &&
                bitRate.ValueKind == JsonValueKind.String &&
                long.TryParse(bitRate.GetString(), out var bps)) {
                children.Add(Leaf($"{prefix}.bitrate", "Bit rate", FormatBitRate(bps)));
            } else if (format.TryGetProperty("bit_rate", out bitRate) &&
                       bitRate.ValueKind == JsonValueKind.Number &&
                       bitRate.TryGetInt64(out var bpsNum)) {
                children.Add(Leaf($"{prefix}.bitrate", "Bit rate", FormatBitRate(bpsNum)));
            }

            if (format.TryGetProperty("duration", out var duration)) {
                var durationText = duration.ValueKind == JsonValueKind.String
                    ? duration.GetString()
                    : duration.GetRawText();
                if (double.TryParse(durationText, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)) {
                    children.Add(Leaf($"{prefix}.duration", "Duration", FormatDuration(seconds)));
                }
            }
        }

        string? videoCodec = null;
        string? audioCodec = null;
        string? resolution = null;

        if (root.TryGetProperty("streams", out var streams)) {
            foreach (var stream in streams.EnumerateArray()) {
                var codecType = stream.TryGetProperty("codec_type", out var typeEl) ? typeEl.GetString() : null;
                var codecName = stream.TryGetProperty("codec_name", out var nameEl) ? nameEl.GetString() : null;

                if (codecType == "video") {
                    videoCodec = codecName;
                    if (stream.TryGetProperty("width", out var w) && stream.TryGetProperty("height", out var h)) {
                        resolution = $"{w.GetInt32()}x{h.GetInt32()}";
                    }
                } else if (codecType == "audio") {
                    audioCodec = codecName;
                }
            }
        }

        if (resolution != null) {
            children.Add(Leaf($"{prefix}.resolution", "Resolution", resolution));
        }

        var codecLabel = string.Join(
            " / ",
            new[] { videoCodec?.ToUpperInvariant(), audioCodec?.ToUpperInvariant() }
                .Where(c => !string.IsNullOrWhiteSpace(c)));
        children.Add(Leaf(
            $"{prefix}.codec",
            "Codec",
            string.IsNullOrWhiteSpace(codecLabel)
                ? $"{profile.VideoCodec} / {profile.AudioCodec}"
                : codecLabel));
    }

    private static AnalysisTreeNode BuildSitiSummarySection(
        string id,
        string label,
        string idPrefix,
        IReadOnlyDictionary<string, (double AvgSi, double AvgTi)> sitiAverages,
        TranscodeProfile profile) {
        var children = new List<AnalysisTreeNode>();

        foreach (var variant in profile.Variants) {
            if (sitiAverages.TryGetValue(variant.Label, out var averages)) {
                children.Add(Leaf(
                    $"{idPrefix}.siti.{variant.Label}_avg_si",
                    $"{variant.Label} Average SI",
                    averages.AvgSi.ToString("0.####", CultureInfo.InvariantCulture)));
                children.Add(Leaf(
                    $"{idPrefix}.siti.{variant.Label}_avg_ti",
                    $"{variant.Label} Average TI",
                    averages.AvgTi.ToString("0.####", CultureInfo.InvariantCulture)));
            } else {
                children.Add(Leaf(
                    $"{idPrefix}.siti.{variant.Label}_avg_si",
                    $"{variant.Label} Average SI",
                    "—"));
                children.Add(Leaf(
                    $"{idPrefix}.siti.{variant.Label}_avg_ti",
                    $"{variant.Label} Average TI",
                    "—"));
            }
        }

        var status = sitiAverages.Count > 0
            ? AnalysisSectionStatus.Completed
            : AnalysisSectionStatus.Pending;

        return Section(id, label, "ffmpeg-siti", status, children);
    }

    private static AnalysisTreeNode BuildVmafSummarySection(
        string id,
        string label,
        string idPrefix,
        IReadOnlyDictionary<string, VmafSummary> summaries,
        TranscodeProfile profile,
        bool ranVmaf) {
        var children = new List<AnalysisTreeNode>();

        foreach (var variant in profile.Variants) {
            if (summaries.TryGetValue(variant.Label, out var summary)) {
                children.Add(Leaf(
                    $"{idPrefix}.vmaf.{variant.Label}_mean",
                    $"{variant.Label} Mean VMAF",
                    summary.Mean.ToString("0.####", CultureInfo.InvariantCulture)));
                children.Add(Leaf(
                    $"{idPrefix}.vmaf.{variant.Label}_harmonic_mean",
                    $"{variant.Label} Harmonic mean VMAF",
                    summary.HarmonicMean.ToString("0.####", CultureInfo.InvariantCulture)));
                children.Add(Leaf(
                    $"{idPrefix}.vmaf.{variant.Label}_min",
                    $"{variant.Label} Min VMAF",
                    summary.Min.ToString("0.####", CultureInfo.InvariantCulture)));
                if (summary.BitrateBps != null) {
                    children.Add(Leaf(
                        $"{idPrefix}.vmaf.{variant.Label}_bitrate",
                        $"{variant.Label} Target bitrate",
                        FormatBitRate(summary.BitrateBps.Value)));
                }
            } else {
                children.Add(Leaf(
                    $"{idPrefix}.vmaf.{variant.Label}_mean",
                    $"{variant.Label} Mean VMAF",
                    "—"));
            }
        }

        AnalysisSectionStatus status;
        if (summaries.Count > 0) {
            status = AnalysisSectionStatus.Completed;
        } else if (ranVmaf) {
            status = AnalysisSectionStatus.Failed;
        } else {
            status = AnalysisSectionStatus.Pending;
        }

        return Section(id, label, "ffmpeg-libvmaf", status, children);
    }

    private static AnalysisTreeNode CompletedFormatSection(
        string id,
        string label,
        List<AnalysisTreeNode> children) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = "ffprobe-transcode",
                Status = AnalysisSectionStatus.Completed,
                Kind = "section"
            },
            Children = children
        };
    }

    private static AnalysisTreeNode FormatPendingSection(string id, string label, string error) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = "ffprobe-transcode",
                Status = AnalysisSectionStatus.Pending,
                Kind = "section",
                Error = error
            }
        };
    }

    private static AnalysisTreeNode Section(
        string id,
        string label,
        string source,
        AnalysisSectionStatus status,
        List<AnalysisTreeNode> children) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = status,
                Kind = "section"
            },
            Children = children
        };
    }

    private static AnalysisTreeNode Leaf(string id, string label, string? value) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Value = value
        };
    }

    private static string FormatTargetBitrate(string bitrate) {
        var kbps = TranscodeProfile.ParseBitrateKbps(bitrate);
        if (kbps >= 1000) {
            return $"{kbps / 1000.0:0.##} Mb/s";
        }

        return $"{kbps} kb/s";
    }

    private static string FormatBitRate(long bitRate) {
        if (bitRate >= 1_000_000) {
            return $"{bitRate / 1_000_000.0:0.##} Mb/s";
        }

        return $"{bitRate / 1000.0:0.##} kb/s";
    }

    private static string FormatDuration(double seconds) {
        var total = TimeSpan.FromSeconds(seconds);
        if (total.TotalHours >= 1) {
            return $"{(int)total.TotalHours} h {total.Minutes} min {total.Seconds} s";
        }

        if (total.TotalMinutes >= 1) {
            return $"{(int)total.TotalMinutes} min {total.Seconds} s";
        }

        return $"{seconds:0.###} s";
    }

    private static bool TryGetVideoResolution(JsonDocument probeData, out int width, out int height) {
        width = 0;
        height = 0;
        if (!probeData.RootElement.TryGetProperty("streams", out var streams)) {
            return false;
        }

        foreach (var stream in streams.EnumerateArray()) {
            var codecType = stream.TryGetProperty("codec_type", out var typeEl) ? typeEl.GetString() : null;
            if (codecType != "video") {
                continue;
            }

            if (stream.TryGetProperty("width", out var w) &&
                stream.TryGetProperty("height", out var h) &&
                w.TryGetInt32(out width) &&
                h.TryGetInt32(out height) &&
                width > 0 &&
                height > 0) {
                return true;
            }
        }

        return false;
    }

    private static void ParseVariantResolution(string resolution, out int? width, out int? height) {
        width = null;
        height = null;
        var parts = resolution.Split(':', 'x', 'X');
        if (parts.Length == 2 &&
            int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var w) &&
            int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var h)) {
            width = w;
            height = h;
        }
    }

    private sealed class ReferenceVideoInfo {
        public required string Path { get; init; }
        public required int Width { get; init; }
        public required int Height { get; init; }
    }

    private sealed class DashRepresentationInfo {
        public required string Label { get; init; }
        public required string RepresentationId { get; init; }
        public string? Bandwidth { get; init; }
        public string? Resolution { get; init; }
        public string? Codecs { get; init; }
        public string? InitSegment { get; init; }
    }
}
