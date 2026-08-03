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
}

public sealed class TranscodeAnalysisCollector : ITranscodeAnalysisCollector {
    private readonly IVideoStorageService _storage;
    private readonly IMediaProbeService _mediaProbe;
    private readonly ISitiAnalysisService _sitiAnalysis;
    private readonly IFfmpegRunner _ffmpeg;
    private readonly IVideoTranscodeAnalysisService _analysis;
    private readonly ILogger<TranscodeAnalysisCollector> _logger;

    public TranscodeAnalysisCollector(
        IVideoStorageService storage,
        IMediaProbeService mediaProbe,
        ISitiAnalysisService sitiAnalysis,
        IFfmpegRunner ffmpeg,
        IVideoTranscodeAnalysisService analysis,
        ILogger<TranscodeAnalysisCollector> logger) {
        _storage = storage;
        _mediaProbe = mediaProbe;
        _sitiAnalysis = sitiAnalysis;
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

        if (hasHls) {
            var hlsSeries = new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectHlsAsync(routeId, transcodeId, profile, hlsSeries, cancellationToken);
            if (hlsSeries.Count > 0) {
                sitiByFormat.Hls = hlsSeries;
            }
        } else {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                FormatPendingSection("hls", "HLS", "HLS not produced for this packaging run"),
                cancellationToken);
        }

        if (hasDash) {
            var dashSeries = new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase);
            await CollectDashAsync(routeId, transcodeId, profile, dashSeries, cancellationToken);
            if (dashSeries.Count > 0) {
                sitiByFormat.Dash = dashSeries;
            }
        } else {
            await _analysis.UpsertSectionAsync(
                transcodeId,
                FormatPendingSection("dash", "DASH", "DASH not produced for this packaging run"),
                cancellationToken);
        }

        if (sitiByFormat.Hls != null || sitiByFormat.Dash != null) {
            await _analysis.SetSeriesAsync(
                transcodeId,
                new AnalysisSeriesDocument { SitiByFormat = sitiByFormat },
                cancellationToken);
        }
    }

    private async Task CollectHlsAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        Dictionary<string, SitiSeriesData> sitiByRendition,
        CancellationToken cancellationToken) {
        await _analysis.MarkSectionRunningAsync(
            transcodeId,
            "hls",
            "HLS",
            "ffprobe-transcode",
            cancellationToken);

        try {
            var hlsDir = _storage.GetHlsDir(routeId, transcodeId);
            var sitiAverages = new Dictionary<string, (double AvgSi, double AvgTi)>(StringComparer.OrdinalIgnoreCase);
            var children = new List<AnalysisTreeNode> {
                BuildHlsGeneralSection(profile, hlsDir)
            };

            foreach (var variant in profile.Variants) {
                var playlistPath = Path.Combine(hlsDir, $"{variant.Label}.m3u8");
                children.Add(await BuildHlsVariantSectionAsync(variant, playlistPath, profile, cancellationToken));

                var sitiResult = await AnalyzeHlsRenditionSitiAsync(playlistPath, variant.Label, cancellationToken);
                RecordSitiResult(variant.Label, sitiResult, sitiByRendition, sitiAverages);
            }

            children.Add(BuildSitiSummarySection("hls.siti", "SI/TI (per rendition)", "hls", sitiAverages, profile));

            await _analysis.UpsertSectionAsync(
                transcodeId,
                CompletedFormatSection("hls", "HLS", children),
                cancellationToken);

            _logger.LogInformation("HLS analysis completed for {RouteId}/{TranscodeId}", routeId, transcodeId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "HLS analysis failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
            await _analysis.MarkSectionFailedAsync(
                transcodeId,
                "hls",
                "HLS",
                "ffprobe-transcode",
                ex.Message,
                cancellationToken);
        }
    }

    private async Task CollectDashAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        Dictionary<string, SitiSeriesData> sitiByRendition,
        CancellationToken cancellationToken) {
        await _analysis.MarkSectionRunningAsync(
            transcodeId,
            "dash",
            "DASH",
            "ffprobe-transcode",
            cancellationToken);

        try {
            var dashDir = _storage.GetDashDir(routeId, transcodeId);
            var manifestPath = Path.Combine(dashDir, "manifest.mpd");
            var sitiAverages = new Dictionary<string, (double AvgSi, double AvgTi)>(StringComparer.OrdinalIgnoreCase);
            var children = new List<AnalysisTreeNode>();

            var reps = ParseDashVideoRepresentations(manifestPath, profile);
            children.Add(BuildDashGeneralSection(profile, manifestPath, reps));

            foreach (var variant in profile.Variants) {
                var rep = reps.FirstOrDefault(item =>
                    string.Equals(item.Label, variant.Label, StringComparison.OrdinalIgnoreCase));
                children.Add(BuildDashVariantSection(variant, profile, rep));

                if (rep == null) {
                    continue;
                }

                var sitiResult = await AnalyzeDashRenditionSitiAsync(
                    dashDir,
                    rep.RepresentationId,
                    variant.Label,
                    cancellationToken);
                RecordSitiResult(variant.Label, sitiResult, sitiByRendition, sitiAverages);
            }

            children.Add(BuildSitiSummarySection("dash.siti", "SI/TI (per rendition)", "dash", sitiAverages, profile));

            await _analysis.UpsertSectionAsync(
                transcodeId,
                CompletedFormatSection("dash", "DASH", children),
                cancellationToken);

            _logger.LogInformation("DASH analysis completed for {RouteId}/{TranscodeId}", routeId, transcodeId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "DASH analysis failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
            await _analysis.MarkSectionFailedAsync(
                transcodeId,
                "dash",
                "DASH",
                "ffprobe-transcode",
                ex.Message,
                cancellationToken);
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

    private async Task<SitiAnalysisResult> AnalyzeHlsRenditionSitiAsync(
        string playlistPath,
        string label,
        CancellationToken cancellationToken) {
        if (!File.Exists(playlistPath)) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = $"Playlist not found for {label}"
            };
        }

        // Remux HLS playlist to a continuous temp file — lavfi movie filter needs a seekable input.
        var tempDir = Path.Combine(Path.GetTempPath(), $"transcode-siti-hls-{Guid.NewGuid():N}");
        var tempMp4 = Path.Combine(tempDir, $"{label}.mp4");

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
                    "Failed to remux HLS {Label} for SI/TI: {Error}",
                    label,
                    remux.ErrorMessage ?? remux.StdErr);
                return new SitiAnalysisResult {
                    Success = false,
                    ErrorMessage = remux.ErrorMessage ?? $"Failed to remux HLS {label} for SI/TI"
                };
            }

            return await _sitiAnalysis.AnalyzeAsync(tempMp4, cancellationToken);
        } catch (Exception ex) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        } finally {
            TryDeleteDirectory(tempDir);
        }
    }

    private async Task<SitiAnalysisResult> AnalyzeDashRenditionSitiAsync(
        string dashDir,
        string representationId,
        string label,
        CancellationToken cancellationToken) {
        var initPath = Path.Combine(dashDir, $"init-{representationId}.m4s");
        if (!File.Exists(initPath)) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = $"Init segment not found for DASH {label} (id={representationId})"
            };
        }

        var chunks = Directory.GetFiles(dashDir, $"chunk-{representationId}-*.m4s")
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (chunks.Count == 0) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = $"No media chunks found for DASH {label} (id={representationId})"
            };
        }

        // Binary-concat init + media segments into a temporary fMP4, then run siti.
        var tempDir = Path.Combine(Path.GetTempPath(), $"transcode-siti-dash-{Guid.NewGuid():N}");
        var tempMp4 = Path.Combine(tempDir, $"{label}.mp4");

        try {
            Directory.CreateDirectory(tempDir);

            await using (var output = File.Create(tempMp4)) {
                await CopyFileToAsync(initPath, output, cancellationToken);
                foreach (var chunk in chunks) {
                    await CopyFileToAsync(chunk, output, cancellationToken);
                }
            }

            return await _sitiAnalysis.AnalyzeAsync(tempMp4, cancellationToken);
        } catch (Exception ex) {
            return new SitiAnalysisResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        } finally {
            TryDeleteDirectory(tempDir);
        }
    }

    private void TryDeleteDirectory(string tempDir) {
        try {
            if (Directory.Exists(tempDir)) {
                Directory.Delete(tempDir, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Failed to delete temp SI/TI directory {Path}", tempDir);
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
                "dash.general.representations_found",
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

    private sealed class DashRepresentationInfo {
        public required string Label { get; init; }
        public required string RepresentationId { get; init; }
        public string? Bandwidth { get; init; }
        public string? Resolution { get; init; }
        public string? Codecs { get; init; }
        public string? InitSegment { get; init; }
    }
}
