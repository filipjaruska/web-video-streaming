using System.Globalization;
using System.Text.Json;
using System.Xml.Linq;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Probes and scores the packaged output of one transcode run. Both delivery formats follow the
/// same shape — describe each rendition, reassemble it into a plain MP4, then run SI/TI or VMAF
/// over it — so they share one collection path and differ only in how a rendition is located and
/// materialised.
/// </summary>
public sealed class TranscodeAnalysisCollector {
    private const string HlsId = "hls";
    private const string DashId = "dash";

    private readonly MediaPaths _paths;
    private readonly MediaProbe _probe;
    private readonly Transcoder _transcoder;
    private readonly SitiAnalyzer _siti;
    private readonly VmafAnalyzer _vmaf;
    private readonly AnalysisStore _store;
    private readonly ILogger<TranscodeAnalysisCollector> _logger;

    public TranscodeAnalysisCollector(
        MediaPaths paths,
        MediaProbe probe,
        Transcoder transcoder,
        SitiAnalyzer siti,
        VmafAnalyzer vmaf,
        AnalysisStore store,
        ILogger<TranscodeAnalysisCollector> logger) {
        _paths = paths;
        _probe = probe;
        _transcoder = transcoder;
        _siti = siti;
        _vmaf = vmaf;
        _store = store;
        _logger = logger;
    }

    /// <summary>Builds the per-format probe tree and per-rendition SI/TI series.</summary>
    public Task CollectAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) =>
        RunAsync(routeId, transcodeId, hasHls, hasDash, profile, runSiti: true, runVmaf: false, cancellationToken);

    /// <summary>Scores each packaged rendition with full-reference VMAF against the source.</summary>
    public Task CollectVmafAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) =>
        RunAsync(routeId, transcodeId, hasHls, hasDash, profile, runSiti: false, runVmaf: true, cancellationToken);

    private async Task RunAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        TranscodeProfile? profile,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        profile ??= TranscodeProfile.Default;
        var reference = await ResolveReferenceAsync(routeId, cancellationToken);

        var siti = new FormatSitiSeriesDocument();
        var vmaf = new FormatVmafSeriesDocument();

        foreach (var (formatId, formatLabel, produced) in
                 new[] { (HlsId, "HLS", hasHls), (DashId, "DASH", hasDash) }) {
            if (!produced) {
                if (runSiti) {
                    await _store.UpsertSectionAsync(
                        AnalysisOwner.Transcode,
                        transcodeId,
                        Section(
                            formatId,
                            formatLabel,
                            TranscodeProbeSource,
                            AnalysisSectionStatus.Pending,
                            $"{formatLabel} not produced for this packaging run"),
                        cancellationToken);
                }

                continue;
            }

            var sitiByRendition = runSiti
                ? new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase)
                : null;
            var vmafByRendition = runVmaf
                ? new Dictionary<string, VmafSeriesData>(StringComparer.OrdinalIgnoreCase)
                : null;

            await CollectFormatAsync(
                routeId,
                transcodeId,
                formatId,
                formatLabel,
                profile,
                reference,
                sitiByRendition,
                vmafByRendition,
                runSiti,
                runVmaf,
                cancellationToken);

            if (sitiByRendition is { Count: > 0 }) {
                if (formatId == HlsId) {
                    siti.Hls = sitiByRendition;
                } else {
                    siti.Dash = sitiByRendition;
                }
            }

            if (vmafByRendition is { Count: > 0 }) {
                if (formatId == HlsId) {
                    vmaf.Hls = vmafByRendition;
                } else {
                    vmaf.Dash = vmafByRendition;
                }
            }
        }

        if (runSiti && (siti.Hls != null || siti.Dash != null)) {
            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                transcodeId,
                new AnalysisSeriesDocument { SitiByFormat = siti },
                cancellationToken);
        }

        if (runVmaf) {
            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                transcodeId,
                new AnalysisSeriesDocument { VmafByFormat = vmaf },
                cancellationToken);
        }
    }

    private async Task CollectFormatAsync(
        string routeId,
        Guid transcodeId,
        string formatId,
        string formatLabel,
        TranscodeProfile profile,
        ReferenceVideo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        if (runSiti) {
            await _store.MarkRunningAsync(
                AnalysisOwner.Transcode,
                transcodeId,
                formatId,
                formatLabel,
                TranscodeProbeSource,
                cancellationToken);
        }

        try {
            var children = new List<AnalysisTreeNode>();
            var sitiAverages = new Dictionary<string, (double Si, double Ti)>(StringComparer.OrdinalIgnoreCase);
            var vmafSummaries = new Dictionary<string, VmafSummary>(StringComparer.OrdinalIgnoreCase);

            var renditions = formatId == HlsId
                ? await PlanHlsAsync(routeId, transcodeId, profile, runSiti, children, cancellationToken)
                : PlanDash(routeId, transcodeId, profile, runSiti, children);

            foreach (var rendition in renditions) {
                await AnalyzeRenditionAsync(
                    rendition,
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
                children.Add(BuildSitiSummary(formatId, sitiAverages, profile));
            }

            var vmafSection = BuildVmafSummary(formatId, vmafSummaries, profile, runVmaf);
            children.Add(vmafSection);

            if (runSiti) {
                await _store.UpsertSectionAsync(
                    AnalysisOwner.Transcode,
                    transcodeId,
                    FormatSection(formatId, formatLabel, children),
                    cancellationToken);
            } else if (runVmaf) {
                await MergeVmafIntoFormatSectionAsync(transcodeId, formatId, formatLabel, vmafSection, cancellationToken);
            }

            _logger.LogInformation(
                "{Format} analysis completed for {RouteId}/{TranscodeId}",
                formatLabel,
                routeId,
                transcodeId);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "{Format} analysis failed for {RouteId}/{TranscodeId}", formatLabel, routeId, transcodeId);
            if (runSiti) {
                await _store.MarkFailedAsync(
                    AnalysisOwner.Transcode,
                    transcodeId,
                    formatId,
                    formatLabel,
                    TranscodeProbeSource,
                    ex.Message,
                    cancellationToken);
            }
        }
    }

    // —— Per-format planning ——————————————————————————————————————————————

    /// <summary>
    /// A packaged rendition: which ladder rung it is, and how to turn it back into a plain MP4
    /// that ffprobe and libvmaf can read.
    /// </summary>
    private sealed record Rendition(
        TranscodeVariant Variant,
        Func<string, CancellationToken, Task<bool>> Materialize);

    private async Task<List<Rendition>> PlanHlsAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        bool runSiti,
        List<AnalysisTreeNode> children,
        CancellationToken cancellationToken) {
        var hlsDir = _paths.HlsDir(routeId, transcodeId);
        var renditions = new List<Rendition>();

        if (runSiti) {
            children.Add(BuildHlsGeneralSection(profile, hlsDir));
        }

        foreach (var variant in profile.Variants) {
            var playlistPath = Path.Combine(hlsDir, MediaNames.HlsPlaylist(variant.Label));

            if (runSiti) {
                children.Add(await BuildHlsVariantSectionAsync(variant, playlistPath, profile, cancellationToken));
            }

            if (!File.Exists(playlistPath)) {
                _logger.LogWarning("Playlist not found for HLS {Label}", variant.Label);
                continue;
            }

            renditions.Add(new Rendition(
                variant,
                async (destination, ct) => {
                    var remux = await _transcoder.RemuxAsync(playlistPath, destination, ct);
                    if (!remux.Success) {
                        _logger.LogWarning("Failed to remux HLS {Label}: {Error}", variant.Label, remux.ErrorMessage);
                    }

                    return remux.Success;
                }));
        }

        return renditions;
    }

    private List<Rendition> PlanDash(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        bool runSiti,
        List<AnalysisTreeNode> children) {
        var dashDir = _paths.DashDir(routeId, transcodeId);
        var manifestPath = Path.Combine(dashDir, MediaNames.DashManifest);
        var representations = ParseDashRepresentations(manifestPath, profile);
        var renditions = new List<Rendition>();

        if (runSiti) {
            children.Add(BuildDashGeneralSection(profile, manifestPath, representations));
        }

        foreach (var variant in profile.Variants) {
            var representation = representations.FirstOrDefault(item =>
                string.Equals(item.Label, variant.Label, StringComparison.OrdinalIgnoreCase));

            if (runSiti) {
                children.Add(BuildDashVariantSection(variant, profile, representation));
            }

            if (representation == null) {
                continue;
            }

            var initPath = Path.Combine(dashDir, MediaNames.DashInit(representation.RepresentationId));
            if (!File.Exists(initPath)) {
                _logger.LogWarning(
                    "Init segment not found for DASH {Label} (id={Id})",
                    variant.Label,
                    representation.RepresentationId);
                continue;
            }

            var chunks = Directory
                .GetFiles(dashDir, MediaNames.DashChunkGlob(representation.RepresentationId))
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (chunks.Count == 0) {
                _logger.LogWarning(
                    "No media chunks found for DASH {Label} (id={Id})",
                    variant.Label,
                    representation.RepresentationId);
                continue;
            }

            renditions.Add(new Rendition(
                variant,
                async (destination, ct) => {
                    // fMP4 segments concatenate directly — no remux needed.
                    await using var output = File.Create(destination);
                    await CopyIntoAsync(initPath, output, ct);
                    foreach (var chunk in chunks) {
                        await CopyIntoAsync(chunk, output, ct);
                    }

                    return true;
                }));
        }

        return renditions;
    }

    // —— Per-rendition measurement ————————————————————————————————————————

    private async Task AnalyzeRenditionAsync(
        Rendition rendition,
        ReferenceVideo? reference,
        Dictionary<string, SitiSeriesData>? sitiByRendition,
        Dictionary<string, VmafSeriesData>? vmafByRendition,
        Dictionary<string, (double Si, double Ti)> sitiAverages,
        Dictionary<string, VmafSummary> vmafSummaries,
        bool runSiti,
        bool runVmaf,
        CancellationToken cancellationToken) {
        var label = rendition.Variant.Label;
        var tempDir = NewTempDir("transcode-analysis");
        var tempMp4 = Path.Combine(tempDir, $"{label}.mp4");

        try {
            if (!await rendition.Materialize(tempMp4, cancellationToken) || !File.Exists(tempMp4)) {
                return;
            }

            if (runSiti && sitiByRendition != null) {
                var siti = await _siti.AnalyzeAsync(tempMp4, cancellationToken);
                if (siti.Success && siti.Series != null) {
                    sitiByRendition[label] = siti.Series;
                    sitiAverages[label] = (
                        siti.Series.Si.Count > 0 ? siti.Series.Si.Average() : 0,
                        siti.Series.Ti.Count > 0 ? siti.Series.Ti.Average() : 0);
                }
            }

            if (runVmaf && vmafByRendition != null) {
                await ScoreVmafAsync(tempMp4, rendition.Variant, reference, vmafByRendition, vmafSummaries, cancellationToken);
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Rendition analysis failed for {Label}", label);
        } finally {
            TryDeleteDirectory(tempDir, _logger);
        }
    }

    private async Task ScoreVmafAsync(
        string tempMp4,
        TranscodeVariant variant,
        ReferenceVideo? reference,
        Dictionary<string, VmafSeriesData> vmafByRendition,
        Dictionary<string, VmafSummary> vmafSummaries,
        CancellationToken cancellationToken) {
        if (reference == null) {
            _logger.LogWarning("Skipping VMAF for {Label}: source reference unavailable", variant.Label);
            return;
        }

        var size = ParseResolution(variant.Resolution);

        var result = await _vmaf.AnalyzeAsync(
            new VmafRequest {
                ReferencePath = reference.Path,
                DistortedPath = tempMp4,
                ReferenceWidth = reference.Width,
                ReferenceHeight = reference.Height,
                DistortedWidth = size?.Width,
                DistortedHeight = size?.Height,
                BitrateBps = TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000L
            },
            cancellationToken);

        if (!result.Success || result.Series == null) {
            _logger.LogWarning("VMAF failed for {Label}: {Error}", variant.Label, result.ErrorMessage);
            return;
        }

        vmafByRendition[variant.Label] = result.Series;
        vmafSummaries[variant.Label] = result.Series.Summary;
    }

    private sealed record ReferenceVideo(string Path, int Width, int Height);

    private async Task<ReferenceVideo?> ResolveReferenceAsync(string routeId, CancellationToken cancellationToken) {
        var sourcePath = _paths.ResolveSource(routeId);
        if (sourcePath == null) {
            _logger.LogWarning("Source path missing for VMAF reference {RouteId}", routeId);
            return null;
        }

        var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
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

            return new ReferenceVideo(sourcePath, width, height);
        }
    }

    /// <summary>
    /// The VMAF pass runs after the probe pass, so it grafts its section into the format section
    /// the probe pass already wrote rather than replacing it.
    /// </summary>
    private async Task MergeVmafIntoFormatSectionAsync(
        Guid transcodeId,
        string formatId,
        string formatLabel,
        AnalysisTreeNode vmafSection,
        CancellationToken cancellationToken) {
        var documents = await _store.TryGetAsync(AnalysisOwner.Transcode, transcodeId, cancellationToken);
        var existing = documents?.Tree.Children.FirstOrDefault(node => node.Id == formatId);

        var children = existing?.Children?.ToList() ?? [];
        children.RemoveAll(child => child.Id == vmafSection.Id);
        children.Add(vmafSection);

        await _store.UpsertSectionAsync(
            AnalysisOwner.Transcode,
            transcodeId,
            FormatSection(formatId, formatLabel, children),
            cancellationToken);
    }

    // —— Tree sections ————————————————————————————————————————————————————

    private static AnalysisTreeNode FormatSection(string id, string label, List<AnalysisTreeNode> children) =>
        Section(id, label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);

    private static AnalysisTreeNode BuildHlsGeneralSection(TranscodeProfile profile, string hlsDir) {
        var masterExists = File.Exists(Path.Combine(hlsDir, MediaNames.HlsMaster));

        return Section("hls.general", "General", TranscodeProbeSource, AnalysisSectionStatus.Completed, children: [
            Leaf("hls.general.playlist", "Master playlist", $"hls/{MediaNames.HlsMaster}"),
            Leaf("hls.general.format", "Format", "HLS / MPEG-TS"),
            Leaf("hls.general.variants", "Variant count", Count(profile.Variants.Count)),
            Leaf("hls.general.profile", "Transcode profile", profile.Name),
            Leaf("hls.general.master_present", "Master playlist present", masterExists ? "Yes" : "No")
        ]);
    }

    private async Task<AnalysisTreeNode> BuildHlsVariantSectionAsync(
        TranscodeVariant variant,
        string playlistPath,
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        var prefix = $"hls.{variant.Label}";
        var children = TargetLeaves(prefix, variant, profile, "playlist", "Media playlist", $"hls/{MediaNames.HlsPlaylist(variant.Label)}");

        if (!File.Exists(playlistPath)) {
            children.Add(Leaf($"{prefix}.error", "Probe error", "Playlist not found"));
            return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Failed, children: children);
        }

        var probe = await _probe.ProbeAsync(playlistPath, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            children.Add(Leaf($"{prefix}.error", "Probe error", probe.ErrorMessage ?? "ffprobe failed"));
            children.Add(Leaf($"{prefix}.codec", "Codec", $"{profile.VideoCodec} / {profile.AudioCodec}"));
            return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Failed, children: children);
        }

        using (probe.ProbeData) {
            AppendProbeLeaves(children, prefix, probe.ProbeData, profile);
        }

        return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static AnalysisTreeNode BuildDashGeneralSection(
        TranscodeProfile profile,
        string manifestPath,
        IReadOnlyList<DashRepresentation> representations) {
        var children = new List<AnalysisTreeNode> {
            Leaf("dash.general.manifest", "Manifest", $"dash/{MediaNames.DashManifest}"),
            Leaf("dash.general.format", "Format", "MPEG-DASH / fMP4"),
            Leaf("dash.general.variants", "Variant count", Count(profile.Variants.Count)),
            Leaf("dash.general.profile", "Transcode profile", profile.Name),
            Leaf("dash.general.manifest_present", "Manifest present", File.Exists(manifestPath) ? "Yes" : "No"),
            Leaf("dash.general.reps_found", "Representations found", Count(representations.Count))
        };

        if (File.Exists(manifestPath)) {
            try {
                var profiles = XDocument.Load(manifestPath).Root?.Attribute("profiles")?.Value;
                AddIfPresent(children, "dash.general.mpd_profiles", "MPD profiles", profiles);
            } catch {
                // Per-rung sections already report missing data; a bad MPD header is not worth failing on.
            }
        }

        return Section("dash.general", "General", TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static AnalysisTreeNode BuildDashVariantSection(
        TranscodeVariant variant,
        TranscodeProfile profile,
        DashRepresentation? representation) {
        var prefix = $"dash.{variant.Label}";
        var children = TargetLeaves(prefix, variant, profile, "manifest", "Manifest", $"dash/{MediaNames.DashManifest}");

        if (representation == null) {
            children.Add(Leaf($"{prefix}.error", "Probe error", "Representation not found in MPD"));
            return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Failed, children: children);
        }

        children.Add(Leaf($"{prefix}.representation_id", "Representation ID", representation.RepresentationId));
        AddIfPresent(children, $"{prefix}.bandwidth", "Bandwidth", representation.Bandwidth);
        AddIfPresent(children, $"{prefix}.resolution", "Resolution", representation.Resolution);
        children.Add(Leaf(
            $"{prefix}.codec",
            "Codec",
            representation.Codecs ?? $"{profile.VideoCodec} / {profile.AudioCodec}"));
        AddIfPresent(children, $"{prefix}.init", "Init segment", representation.InitSegment != null ? $"dash/{representation.InitSegment}" : null);

        return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    /// <summary>The four leaves every rung carries, whichever delivery format produced it.</summary>
    private static List<AnalysisTreeNode> TargetLeaves(
        string prefix,
        TranscodeVariant variant,
        TranscodeProfile profile,
        string entryId,
        string entryLabel,
        string entryValue) => [
        Leaf($"{prefix}.{entryId}", entryLabel, entryValue),
        Leaf($"{prefix}.target_resolution", "Target resolution", variant.Resolution.Replace(':', 'x')),
        Leaf($"{prefix}.target_bitrate", "Target bit rate", FormatBitrate(TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000L)),
        Leaf($"{prefix}.segment", "Segment duration", $"{profile.SegmentDurationSeconds.ToString("0.###", CultureInfo.InvariantCulture)} s")
    ];

    private static AnalysisTreeNode BuildSitiSummary(
        string formatId,
        IReadOnlyDictionary<string, (double Si, double Ti)> averages,
        TranscodeProfile profile) {
        var children = new List<AnalysisTreeNode>();

        foreach (var variant in profile.Variants) {
            var found = averages.TryGetValue(variant.Label, out var average);
            children.Add(Leaf(
                $"{formatId}.siti.{variant.Label}_avg_si",
                $"{variant.Label} Average SI",
                found ? Stat(average.Si) : "—"));
            children.Add(Leaf(
                $"{formatId}.siti.{variant.Label}_avg_ti",
                $"{variant.Label} Average TI",
                found ? Stat(average.Ti) : "—"));
        }

        return Section(
            $"{formatId}.siti",
            "SI/TI (per rendition)",
            "ffmpeg-siti",
            averages.Count > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Pending,
            children: children);
    }

    private static AnalysisTreeNode BuildVmafSummary(
        string formatId,
        IReadOnlyDictionary<string, VmafSummary> summaries,
        TranscodeProfile profile,
        bool ranVmaf) {
        var children = new List<AnalysisTreeNode>();

        foreach (var variant in profile.Variants) {
            if (!summaries.TryGetValue(variant.Label, out var summary)) {
                children.Add(Leaf($"{formatId}.vmaf.{variant.Label}_mean", $"{variant.Label} Mean VMAF", "—"));
                continue;
            }

            children.Add(Leaf($"{formatId}.vmaf.{variant.Label}_mean", $"{variant.Label} Mean VMAF", Stat(summary.Mean)));
            children.Add(Leaf($"{formatId}.vmaf.{variant.Label}_harmonic_mean", $"{variant.Label} Harmonic mean VMAF", Stat(summary.HarmonicMean)));
            children.Add(Leaf($"{formatId}.vmaf.{variant.Label}_min", $"{variant.Label} Min VMAF", Stat(summary.Min)));

            if (summary.BitrateBps != null) {
                children.Add(Leaf(
                    $"{formatId}.vmaf.{variant.Label}_bitrate",
                    $"{variant.Label} Target bitrate",
                    FormatBitrate(summary.BitrateBps.Value)));
            }
        }

        var status = summaries.Count > 0
            ? AnalysisSectionStatus.Completed
            : ranVmaf
                ? AnalysisSectionStatus.Failed
                : AnalysisSectionStatus.Pending;

        return Section($"{formatId}.vmaf", "VMAF (per rendition)", "ffmpeg-libvmaf", status, children: children);
    }

    private static void AppendProbeLeaves(
        List<AnalysisTreeNode> children,
        string prefix,
        JsonDocument probeData,
        TranscodeProfile profile) {
        var root = probeData.RootElement;

        if (root.TryGetProperty("format", out var format)) {
            AddIfPresent(children, $"{prefix}.bitrate", "Bit rate", FormatBitrate(GetLong(format, "bit_rate")));
            AddIfPresent(children, $"{prefix}.duration", "Duration", FormatDuration(GetDouble(format, "duration")));
        }

        string? videoCodec = null;
        string? audioCodec = null;
        string? resolution = null;

        if (root.TryGetProperty("streams", out var streams)) {
            foreach (var stream in streams.EnumerateArray()) {
                switch (GetString(stream, "codec_type")) {
                    case "video":
                        videoCodec = GetString(stream, "codec_name");
                        var width = GetInt(stream, "width");
                        var height = GetInt(stream, "height");
                        if (width != null && height != null) {
                            resolution = $"{width}x{height}";
                        }

                        break;
                    case "audio":
                        audioCodec = GetString(stream, "codec_name");
                        break;
                }
            }
        }

        AddIfPresent(children, $"{prefix}.resolution", "Resolution", resolution);

        var codecLabel = string.Join(
            " / ",
            new[] { videoCodec?.ToUpperInvariant(), audioCodec?.ToUpperInvariant() }
                .Where(codec => !string.IsNullOrWhiteSpace(codec)));

        children.Add(Leaf(
            $"{prefix}.codec",
            "Codec",
            string.IsNullOrWhiteSpace(codecLabel) ? $"{profile.VideoCodec} / {profile.AudioCodec}" : codecLabel));
    }

    // —— MPD parsing ——————————————————————————————————————————————————————

    private sealed record DashRepresentation(
        string Label,
        string RepresentationId,
        string? Bandwidth,
        string? Resolution,
        string? Codecs,
        string? InitSegment);

    private static List<DashRepresentation> ParseDashRepresentations(string manifestPath, TranscodeProfile profile) {
        var results = new List<DashRepresentation>();
        if (!File.Exists(manifestPath)) {
            return results;
        }

        var doc = XDocument.Load(manifestPath);
        XNamespace ns = doc.Root?.Name.NamespaceName ?? "urn:mpeg:dash:schema:mpd:2011";

        var videoReps = doc.Descendants(ns + "Representation")
            .Where(rep =>
                (rep.Attribute("mimeType")?.Value ?? "").StartsWith("video", StringComparison.OrdinalIgnoreCase) ||
                rep.Attribute("width") != null ||
                rep.Attribute("height") != null)
            .ToList();

        for (var i = 0; i < videoReps.Count; i++) {
            var rep = videoReps[i];
            var width = rep.Attribute("width")?.Value;
            var height = rep.Attribute("height")?.Value;
            var repId = rep.Attribute("id")?.Value ?? i.ToString(CultureInfo.InvariantCulture);

            var template = rep.Element(ns + "SegmentTemplate") ?? rep.Parent?.Element(ns + "SegmentTemplate");
            var initSegment = template?.Attribute("initialization")?.Value
                ?.Replace("$RepresentationID$", repId, StringComparison.Ordinal);

            results.Add(new DashRepresentation(
                MatchVariantLabel(profile, height, i),
                repId,
                rep.Attribute("bandwidth")?.Value,
                width != null && height != null ? $"{width}x{height}" : null,
                rep.Attribute("codecs")?.Value,
                initSegment));
        }

        return results;
    }

    /// <summary>Maps an MPD representation back to a ladder rung by height, falling back to order.</summary>
    private static string MatchVariantLabel(TranscodeProfile profile, string? height, int indexFallback) {
        if (height != null && int.TryParse(height, NumberStyles.Integer, CultureInfo.InvariantCulture, out var h)) {
            var match = profile.Variants.FirstOrDefault(variant =>
                ParseResolution(variant.Resolution)?.Height == h);
            if (match != null) {
                return match.Label;
            }
        }

        if (indexFallback >= 0 && indexFallback < profile.Variants.Count) {
            return profile.Variants[indexFallback].Label;
        }

        return height != null ? $"{height}p" : $"rep{indexFallback}";
    }

    private static async Task CopyIntoAsync(string path, Stream output, CancellationToken cancellationToken) {
        await using var input = File.OpenRead(path);
        await input.CopyToAsync(output, cancellationToken);
    }

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Stat(double value) => value.ToString("0.####", CultureInfo.InvariantCulture);
}
