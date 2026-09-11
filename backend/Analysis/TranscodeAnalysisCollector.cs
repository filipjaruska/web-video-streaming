using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;
using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Describes, verifies and scores the output of one packaging run.
/// </summary>
/// <remarks>
/// <para>
/// Every rung is encoded once and stream-copied into both HLS and DASH, so each rung is measured
/// once — SI/TI and VMAF run on the encoded rendition file — and the one result is recorded under
/// both formats. The first full run scored the two protocols separately because they were separate
/// x264 runs, which doubled the analysis cost and reported encoder noise as a protocol difference.
/// </para>
/// <para>
/// Recording one score for both is only honest if both packages really carry that file, so it is
/// checked rather than assumed: the video stream hash of each rendition, its reassembled HLS
/// segments and its reassembled DASH segments must match; the segment tables must be identical
/// across rungs and protocols; packaging must not move audio against video; and both manifests
/// must declare the same bandwidth. A failed check marks the format sections failed and lists what
/// differed.
/// </para>
/// </remarks>
public sealed class TranscodeAnalysisCollector {
    private const string HlsId = "hls";
    private const string DashId = "dash";

    /// <summary>Two segment durations closer than this are the same cut — EXTINF is printed to microseconds.</summary>
    private const double SegmentToleranceSec = 0.002;

    private static readonly (string Id, string Label)[] AllFormats = [(HlsId, "HLS"), (DashId, "DASH")];

    private readonly MediaPaths _paths;
    private readonly MediaProbe _probe;
    private readonly ProcessRunner _runner;
    private readonly SitiAnalyzer _siti;
    private readonly VmafAnalyzer _vmaf;
    private readonly AnalysisStore _store;
    private readonly ILogger<TranscodeAnalysisCollector> _logger;

    public TranscodeAnalysisCollector(
        MediaPaths paths,
        MediaProbe probe,
        ProcessRunner runner,
        SitiAnalyzer siti,
        VmafAnalyzer vmaf,
        AnalysisStore store,
        ILogger<TranscodeAnalysisCollector> logger) {
        _paths = paths;
        _probe = probe;
        _runner = runner;
        _siti = siti;
        _vmaf = vmaf;
        _store = store;
        _logger = logger;
    }

    /// <summary>An encoded rung on disk, with what was measured about it.</summary>
    private sealed record EncodedRung(
        TranscodeVariant Variant,
        string Path,
        int Height,
        VideoRateStats? Rate,
        RungDescription? Description);

    private sealed record RungDescription(string? Resolution, string? Codec, double? DurationSec);

    /// <summary>Builds the per-format tree, verifies the packaging, and runs SI/TI once per rung.</summary>
    public async Task CollectAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) {
        profile ??= TranscodeProfile.Default;
        var formats = Produced(hasHls, hasDash);

        foreach (var (id, label) in AllFormats) {
            if (formats.Any(format => format.Id == id)) {
                await _store.MarkRunningAsync(AnalysisOwner.Transcode, transcodeId, id, label, TranscodeProbeSource, cancellationToken);
            } else {
                await _store.UpsertSectionAsync(
                    AnalysisOwner.Transcode,
                    transcodeId,
                    Section(id, label, TranscodeProbeSource, AnalysisSectionStatus.Pending, $"{label} not produced for this packaging run"),
                    cancellationToken);
            }
        }

        if (formats.Count == 0) {
            return;
        }

        try {
            var rungs = await LocateRungsAsync(routeId, transcodeId, profile, describe: true, cancellationToken);
            var representations = hasDash ? ParseDashRepresentations(LoadMpd(routeId, transcodeId), profile) : [];
            var integrity = await VerifyPackagingAsync(routeId, transcodeId, rungs, representations, hasHls, hasDash, cancellationToken);

            var siti = new Dictionary<string, SitiSeriesData>(StringComparer.OrdinalIgnoreCase);
            foreach (var rung in rungs) {
                var result = await _siti.AnalyzeAsync(rung.Path, cancellationToken);
                if (result.Success && result.Series != null) {
                    siti[rung.Variant.Label] = result.Series;
                } else {
                    _logger.LogWarning("SI/TI failed for {Label}: {Error}", rung.Variant.Label, result.ErrorMessage);
                }
            }

            foreach (var (id, label) in formats) {
                var children = new List<AnalysisTreeNode> {
                    id == HlsId
                        ? BuildHlsGeneralSection(profile, routeId, transcodeId, rungs.Count)
                        : BuildDashGeneralSection(profile, routeId, transcodeId, representations)
                };

                foreach (var variant in profile.Variants) {
                    var rung = rungs.FirstOrDefault(item => item.Variant.Label == variant.Label);
                    var check = integrity.Rungs.FirstOrDefault(item => item.Label == variant.Label);
                    children.Add(id == HlsId
                        ? BuildHlsVariantSection(variant, profile, rung, check)
                        : BuildDashVariantSection(
                            variant,
                            profile,
                            rung,
                            representations.FirstOrDefault(rep => rep.IsVideo && string.Equals(rep.Label, variant.Label, StringComparison.OrdinalIgnoreCase))));
                }

                children.Add(BuildIntegritySection(id, integrity));
                children.Add(BuildSitiSummary(id, siti, profile));
                children.Add(BuildVmafSummary(id, new Dictionary<string, VmafSummary>(), profile, ranVmaf: false));

                await _store.UpsertSectionAsync(
                    AnalysisOwner.Transcode,
                    transcodeId,
                    FormatSection(id, label, children, integrity),
                    cancellationToken);
            }

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                transcodeId,
                new AnalysisSeriesDocument {
                    SitiByFormat = siti.Count > 0
                        ? new FormatSitiSeriesDocument { Hls = hasHls ? siti : null, Dash = hasDash ? siti : null }
                        : null,
                    PackagingIntegrity = integrity
                },
                cancellationToken);

            if (integrity.Passed) {
                _logger.LogInformation(
                    "Packaging verified for {RouteId}/{TranscodeId}: {Rungs} rungs, identical bitstreams and segment tables",
                    routeId,
                    transcodeId,
                    integrity.Rungs.Count);
            } else {
                _logger.LogWarning(
                    "Packaging integrity failed for {RouteId}/{TranscodeId}: {Problems}",
                    routeId,
                    transcodeId,
                    string.Join("; ", integrity.Problems));
            }
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Packaging analysis failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
            foreach (var (id, label) in formats) {
                await _store.MarkFailedAsync(AnalysisOwner.Transcode, transcodeId, id, label, TranscodeProbeSource, ex.Message, cancellationToken);
            }
        }
    }

    /// <summary>Scores each encoded rung once with full-reference VMAF against the source.</summary>
    public async Task CollectVmafAsync(
        string routeId,
        Guid transcodeId,
        bool hasHls,
        bool hasDash,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) {
        profile ??= TranscodeProfile.Default;
        var formats = Produced(hasHls, hasDash);
        if (formats.Count == 0) {
            return;
        }

        try {
            var reference = await ResolveReferenceAsync(routeId, cancellationToken);
            var rungs = await LocateRungsAsync(routeId, transcodeId, profile, describe: false, cancellationToken);

            var series = new Dictionary<string, VmafSeriesData>(StringComparer.OrdinalIgnoreCase);
            foreach (var rung in rungs) {
                await ScoreVmafAsync(rung, reference, series, cancellationToken);
            }

            var summaries = series.ToDictionary(pair => pair.Key, pair => pair.Value.Summary, StringComparer.OrdinalIgnoreCase);
            var stored = await _store.TryGetAsync(AnalysisOwner.Transcode, transcodeId, cancellationToken);

            foreach (var (id, label) in formats) {
                await MergeVmafIntoFormatSectionAsync(
                    stored,
                    transcodeId,
                    id,
                    label,
                    BuildVmafSummary(id, summaries, profile, ranVmaf: true),
                    stored?.Series.PackagingIntegrity,
                    cancellationToken);
            }

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                transcodeId,
                new AnalysisSeriesDocument {
                    VmafByFormat = new FormatVmafSeriesDocument {
                        Hls = hasHls ? series : null,
                        Dash = hasDash ? series : null
                    }
                },
                cancellationToken);

            _logger.LogInformation("VMAF completed for {RouteId}/{TranscodeId}: {Count} rungs", routeId, transcodeId, series.Count);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "VMAF collection failed for {RouteId}/{TranscodeId}", routeId, transcodeId);
        }
    }

    private static List<(string Id, string Label)> Produced(bool hasHls, bool hasDash) =>
        AllFormats.Where(format => format.Id == HlsId ? hasHls : hasDash).ToList();

    private async Task<List<EncodedRung>> LocateRungsAsync(
        string routeId,
        Guid transcodeId,
        TranscodeProfile profile,
        bool describe,
        CancellationToken cancellationToken) {
        var rungs = new List<EncodedRung>();

        foreach (var variant in profile.Variants) {
            var path = _paths.RenditionFile(routeId, transcodeId, variant.Label);
            if (!File.Exists(path)) {
                _logger.LogWarning("Rendition not found for {Label} at {Path}", variant.Label, path);
                continue;
            }

            rungs.Add(new EncodedRung(
                variant,
                path,
                ParseResolution(variant.Resolution)?.Height ?? 0,
                await MeasureVideoRateAsync(_probe, path, cancellationToken, profile.SegmentDurationSeconds),
                describe ? await DescribeAsync(path, cancellationToken) : null));
        }

        return rungs;
    }

    private async Task<RungDescription?> DescribeAsync(string path, CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(path, cancellationToken);
        if (!probe.Success || probe.ProbeData == null) {
            return null;
        }

        using (probe.ProbeData) {
            var root = probe.ProbeData.RootElement;
            string? resolution = null;
            string? codec = null;

            if (root.TryGetProperty("streams", out var streams)) {
                foreach (var stream in streams.EnumerateArray()) {
                    if (GetString(stream, "codec_type") != "video") {
                        continue;
                    }

                    codec = GetString(stream, "codec_name")?.ToUpperInvariant();
                    if (GetString(stream, "profile") is { } profileName) {
                        codec = $"{codec} ({profileName})";
                    }

                    if (GetInt(stream, "width") is { } width && GetInt(stream, "height") is { } height) {
                        resolution = $"{width}x{height}";
                    }

                    break;
                }
            }

            var duration = root.TryGetProperty("format", out var format) ? GetDouble(format, "duration") : null;
            return new RungDescription(resolution, codec, duration);
        }
    }

    // —— Packaging integrity ——————————————————————————————————————————————

    private async Task<PackagingIntegrityDocument> VerifyPackagingAsync(
        string routeId,
        Guid transcodeId,
        List<EncodedRung> rungs,
        List<DashRepresentation> representations,
        bool hasHls,
        bool hasDash,
        CancellationToken cancellationToken) {
        var document = new PackagingIntegrityDocument();
        var problems = document.Problems;

        if (rungs.Count == 0) {
            problems.Add("No encoded renditions found");
            return document;
        }

        var hlsDir = _paths.HlsDir(routeId, transcodeId);
        var dashDir = _paths.DashDir(routeId, transcodeId);
        var audioPath = _paths.SharedAudioFile(routeId);
        var hasAudio = File.Exists(audioPath);
        var tempDir = NewTempDir("packaging-integrity");

        try {
            var master = hasHls ? ParseMasterPlaylist(Path.Combine(hlsDir, MediaNames.HlsMaster)) : [];
            var dashAudio = representations.FirstOrDefault(rep => !rep.IsVideo);

            // What packaging must preserve: the offset between the encoded video and audio inputs.
            // Muxers shift timestamps to keep decode times non-negative, so absolute start times
            // legitimately move; the offset between the two streams must not.
            double? inputOffset = null;
            if (hasAudio) {
                var videoStart = await FirstPtsAsync(rungs[0].Path, "v:0", cancellationToken);
                var audioStart = await FirstPtsAsync(audioPath, "a:0", cancellationToken);
                if (videoStart != null && audioStart != null) {
                    inputOffset = videoStart - audioStart;
                }
            }

            double? hlsAudioStart = null;
            if (hasAudio && hasHls) {
                var concat = Path.Combine(tempDir, "hls-audio.mp4");
                if (await ConcatHlsAsync(hlsDir, MediaNames.HlsAudioName, concat, cancellationToken)) {
                    hlsAudioStart = await FirstPtsAsync(concat, "a:0", cancellationToken);
                } else {
                    problems.Add("HLS audio segments could not be reassembled");
                }
            }

            double? dashAudioStart = null;
            if (hasAudio && hasDash) {
                var concat = Path.Combine(tempDir, "dash-audio.mp4");
                if (dashAudio != null && await ConcatDashAsync(dashDir, dashAudio.RepresentationId, concat, cancellationToken)) {
                    dashAudioStart = await FirstPtsAsync(concat, "a:0", cancellationToken);
                } else {
                    problems.Add("DASH audio segments could not be reassembled");
                }
            }

            foreach (var rung in rungs) {
                var label = rung.Variant.Label;
                var check = new PackagingIntegrityRung {
                    Label = label,
                    RenditionPackets = rung.Rate?.PacketCount,
                    AverageBps = rung.Rate?.AverageBps,
                    PeakSegmentBps = rung.Rate?.PeakSegmentBps
                };
                document.Rungs.Add(check);

                var frameMs = rung.Rate is { PacketCount: > 0 } rate ? rate.DurationSec / rate.PacketCount * 1000 : 1000 / 24.0;

                check.RenditionSha256 = await StreamHashAsync(rung.Path, cancellationToken);
                if (check.RenditionSha256 == null) {
                    problems.Add($"{label}: the encoded rendition could not be hashed");
                }

                if (hasHls) {
                    var concat = Path.Combine(tempDir, $"hls-{label}.mp4");
                    if (await ConcatHlsAsync(hlsDir, label, concat, cancellationToken)) {
                        (check.HlsSha256, check.HlsPackets, check.HlsAvDeltaMs) =
                            await InspectPackagedAsync(concat, hlsAudioStart, inputOffset, cancellationToken);
                    } else {
                        problems.Add($"{label}: HLS segments could not be reassembled");
                    }

                    TryDeleteFile(concat);
                    check.HlsSegmentsSec = ReadExtinf(Path.Combine(hlsDir, MediaNames.HlsPlaylist(label)));

                    if (master.TryGetValue(rung.Height, out var declared)) {
                        check.HlsBandwidthBps = declared.Bandwidth;
                        check.HlsAverageBandwidthBps = declared.Average;
                    }

                    CompareWithRendition("HLS", check.HlsSha256, check.HlsPackets, check.HlsAvDeltaMs);
                }

                if (hasDash) {
                    var representation = representations.FirstOrDefault(rep => rep.IsVideo && rep.Height == rung.Height);
                    if (representation == null) {
                        problems.Add($"{label}: no DASH representation at height {rung.Height}");
                    } else {
                        var concat = Path.Combine(tempDir, $"dash-{label}.mp4");
                        if (await ConcatDashAsync(dashDir, representation.RepresentationId, concat, cancellationToken)) {
                            (check.DashSha256, check.DashPackets, check.DashAvDeltaMs) =
                                await InspectPackagedAsync(concat, dashAudioStart, inputOffset, cancellationToken);
                        } else {
                            problems.Add($"{label}: DASH segments could not be reassembled");
                        }

                        TryDeleteFile(concat);
                        check.DashSegmentsSec = representation.SegmentDurations;
                        check.DashBandwidthBps = representation.Bandwidth + (dashAudio?.Bandwidth ?? 0);
                        CompareWithRendition("DASH", check.DashSha256, check.DashPackets, check.DashAvDeltaMs);
                    }
                }

                if (hasHls && hasDash && check.HlsBandwidthBps != check.DashBandwidthBps) {
                    problems.Add($"{label}: HLS declares {check.HlsBandwidthBps} b/s but the MPD {check.DashBandwidthBps} b/s");
                }

                void CompareWithRendition(string format, string? hash, int? packets, double? avDeltaMs) {
                    if (hash == null) {
                        problems.Add($"{label}: {format} video could not be hashed");
                    } else if (hash != check.RenditionSha256) {
                        problems.Add($"{label}: {format} video differs from the encoded rendition");
                    }

                    if (packets != check.RenditionPackets) {
                        problems.Add($"{label}: {format} carries {packets} video packets, the rendition {check.RenditionPackets}");
                    }

                    if (avDeltaMs is { } delta && Math.Abs(delta) > frameMs) {
                        problems.Add($"{label}: {format} packaging moved audio against video by {delta.ToString("0.#", CultureInfo.InvariantCulture)} ms");
                    }
                }
            }

            var tables = document.Rungs
                .SelectMany(rung => new[] { rung.HlsSegmentsSec, rung.DashSegmentsSec })
                .OfType<List<double>>()
                .Where(table => table.Count > 0)
                .ToList();

            var frameSec = rungs
                .Select(rung => rung.Rate is { PacketCount: > 0 } rate ? rate.DurationSec / rate.PacketCount : 0)
                .DefaultIfEmpty(1 / 24.0)
                .Max();

            document.SegmentTablesIdentical = tables.Count > 0 && tables.All(table => SameCuts(table, tables[0], frameSec));
            if (!document.SegmentTablesIdentical) {
                problems.Add("Segment tables differ — " + string.Join("; ", document.Rungs.Select(rung =>
                    $"{rung.Label} HLS {DescribeSegments(rung.HlsSegmentsSec)}, DASH {DescribeSegments(rung.DashSegmentsSec)}")));
            }

            document.Passed = problems.Count == 0;
            return document;
        } finally {
            TryDeleteDirectory(tempDir, _logger);
        }
    }

    private async Task<(string? Hash, int? Packets, double? AvDeltaMs)> InspectPackagedAsync(
        string path,
        double? audioStart,
        double? inputOffset,
        CancellationToken cancellationToken) {
        var hash = await StreamHashAsync(path, cancellationToken);
        var packets = await _probe.ProbePacketsAsync(path, "v:0", cancellationToken);

        double? delta = null;
        if (packets is { Count: > 0 } && audioStart != null && inputOffset != null) {
            delta = (packets.Min(packet => packet.PtsTime) - audioStart.Value - inputOffset.Value) * 1000;
        }

        return (hash, packets?.Count, delta);
    }

    /// <summary>SHA-256 over the first video stream's packets — equal only for an identical bitstream.</summary>
    private async Task<string?> StreamHashAsync(string path, CancellationToken cancellationToken) {
        var run = await _runner.RunAsync(
            "ffmpeg",
            $@"-v error -i ""{path}"" -map 0:v:0 -c copy -f streamhash -hash sha256 -",
            timeout: TimeSpan.FromMinutes(5),
            cancellationToken: cancellationToken);

        if (!run.Success || string.IsNullOrWhiteSpace(run.StdOut)) {
            return null;
        }

        var match = Regex.Match(run.StdOut, "SHA256=([0-9a-fA-F]+)");
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }

    private async Task<double?> FirstPtsAsync(string path, string streamSelector, CancellationToken cancellationToken) {
        var packets = await _probe.ProbePacketsAsync(path, streamSelector, cancellationToken);
        return packets is { Count: > 0 } ? packets.Min(packet => packet.PtsTime) : null;
    }

    /// <summary>Init segment plus media segments in playlist order — fMP4 fragments concatenate as-is.</summary>
    private static async Task<bool> ConcatHlsAsync(string hlsDir, string name, string destination, CancellationToken cancellationToken) {
        var playlist = Path.Combine(hlsDir, MediaNames.HlsPlaylist(name));
        if (!File.Exists(playlist)) {
            return false;
        }

        var lines = await File.ReadAllLinesAsync(playlist, cancellationToken);
        var init = lines
            .Where(line => line.StartsWith("#EXT-X-MAP:", StringComparison.Ordinal))
            .Select(line => Regex.Match(line, "URI=\"([^\"]+)\""))
            .FirstOrDefault(match => match.Success)?.Groups[1].Value;
        var segments = lines.Where(line => line.Length > 0 && !line.StartsWith('#')).ToList();

        if (init == null || segments.Count == 0) {
            return false;
        }

        var files = segments.Prepend(init).Select(file => Path.Combine(hlsDir, file)).ToList();
        if (!files.All(File.Exists)) {
            return false;
        }

        await using var output = File.Create(destination);
        foreach (var file in files) {
            await CopyIntoAsync(file, output, cancellationToken);
        }

        return true;
    }

    private static async Task<bool> ConcatDashAsync(string dashDir, string representationId, string destination, CancellationToken cancellationToken) {
        var initPath = Path.Combine(dashDir, MediaNames.DashInit(representationId));
        var chunks = Directory.Exists(dashDir)
            ? Directory.GetFiles(dashDir, MediaNames.DashChunkGlob(representationId)).OrderBy(path => path, StringComparer.Ordinal).ToList()
            : [];

        if (!File.Exists(initPath) || chunks.Count == 0) {
            return false;
        }

        await using var output = File.Create(destination);
        await CopyIntoAsync(initPath, output, cancellationToken);
        foreach (var chunk in chunks) {
            await CopyIntoAsync(chunk, output, cancellationToken);
        }

        return true;
    }

    private static List<double>? ReadExtinf(string playlistPath) {
        if (!File.Exists(playlistPath)) {
            return null;
        }

        var durations = new List<double>();
        foreach (var line in File.ReadLines(playlistPath)) {
            if (!line.StartsWith("#EXTINF:", StringComparison.Ordinal)) {
                continue;
            }

            var value = line["#EXTINF:".Length..].Split(',')[0];
            if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var duration)) {
                durations.Add(Math.Round(duration, 6));
            }
        }

        return durations;
    }

    /// <summary>Declared BANDWIDTH / AVERAGE-BANDWIDTH per variant height, read back from the master playlist.</summary>
    private static Dictionary<int, (long Bandwidth, long? Average)> ParseMasterPlaylist(string path) {
        var result = new Dictionary<int, (long Bandwidth, long? Average)>();
        if (!File.Exists(path)) {
            return result;
        }

        foreach (var line in File.ReadLines(path)) {
            if (!line.StartsWith("#EXT-X-STREAM-INF:", StringComparison.Ordinal)) {
                continue;
            }

            var bandwidth = Regex.Match(line, "(?<![-A-Z])BANDWIDTH=(\\d+)");
            var average = Regex.Match(line, "AVERAGE-BANDWIDTH=(\\d+)");
            var resolution = Regex.Match(line, "RESOLUTION=(\\d+)x(\\d+)");

            if (bandwidth.Success && resolution.Success) {
                result[int.Parse(resolution.Groups[2].Value, CultureInfo.InvariantCulture)] = (
                    long.Parse(bandwidth.Groups[1].Value, CultureInfo.InvariantCulture),
                    average.Success ? long.Parse(average.Groups[1].Value, CultureInfo.InvariantCulture) : null);
            }
        }

        return result;
    }

    /// <summary>
    /// Whether two segment tables cut at the same instants. Every segment but the last must match;
    /// the last may differ by up to one frame, because the muxers disagree only on how they report
    /// it — the HLS muxer's final EXTINF stops at the last frame's timestamp, while DASH counts that
    /// frame's duration too (measured 4.171 s against 4.213 s on a one-segment clip).
    /// </summary>
    internal static bool SameCuts(IReadOnlyList<double> a, IReadOnlyList<double> b, double frameSec) {
        if (a.Count != b.Count || a.Count == 0) {
            return false;
        }

        for (var i = 0; i < a.Count - 1; i++) {
            if (Math.Abs(a[i] - b[i]) > SegmentToleranceSec) {
                return false;
            }
        }

        return Math.Abs(a[^1] - b[^1]) <= frameSec + SegmentToleranceSec;
    }

    /// <summary>"5 × 6.006 s + 0.626 s" — runs of equal durations collapsed.</summary>
    private static string DescribeSegments(IReadOnlyList<double>? durations) {
        if (durations is not { Count: > 0 }) {
            return "—";
        }

        var parts = new List<string>();
        for (var i = 0; i < durations.Count;) {
            var j = i;
            while (j + 1 < durations.Count && Math.Abs(durations[j + 1] - durations[i]) <= SegmentToleranceSec) {
                j++;
            }

            var seconds = durations[i].ToString("0.###", CultureInfo.InvariantCulture);
            var count = j - i + 1;
            parts.Add(count > 1 ? $"{count} × {seconds} s" : $"{seconds} s");
            i = j + 1;
        }

        return string.Join(" + ", parts);
    }

    // —— VMAF ——————————————————————————————————————————————————————————————

    private async Task ScoreVmafAsync(
        EncodedRung rung,
        ReferenceVideo? reference,
        Dictionary<string, VmafSeriesData> series,
        CancellationToken cancellationToken) {
        var label = rung.Variant.Label;
        if (reference == null) {
            _logger.LogWarning("Skipping VMAF for {Label}: source reference unavailable", label);
            return;
        }

        var size = ParseResolution(rung.Variant.Resolution);

        // The delivered bitrate of the video stream, not the one the rung was asked for — 2-pass
        // lands within a few percent of target, but the comparison must rest on what shipped.
        var measured = rung.Rate?.AverageBps ?? 0;
        var target = TranscodeProfile.ParseBitrateKbps(rung.Variant.Bitrate) * 1000L;

        var result = await _vmaf.AnalyzeAsync(
            new VmafRequest {
                ReferencePath = reference.Path,
                DistortedPath = rung.Path,
                ReferenceWidth = reference.Width,
                ReferenceHeight = reference.Height,
                DistortedWidth = size?.Width,
                DistortedHeight = size?.Height,
                BitrateBps = measured > 0 ? measured : target,
                TargetBitrateBps = target
            },
            cancellationToken);

        if (!result.Success || result.Series == null) {
            _logger.LogWarning("VMAF failed for {Label}: {Error}", label, result.ErrorMessage);
            return;
        }

        series[label] = result.Series;
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
            _logger.LogWarning("Failed to probe source for VMAF reference {RouteId}: {Error}", routeId, probe.ErrorMessage);
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
        (AnalysisTreeDocument Tree, AnalysisSeriesDocument Series)? stored,
        Guid transcodeId,
        string formatId,
        string formatLabel,
        AnalysisTreeNode vmafSection,
        PackagingIntegrityDocument? integrity,
        CancellationToken cancellationToken) {
        var existing = stored?.Tree.Children.FirstOrDefault(node => node.Id == formatId);

        var children = existing?.Children?.ToList() ?? [];
        children.RemoveAll(child => child.Id == vmafSection.Id);
        children.Add(vmafSection);

        await _store.UpsertSectionAsync(
            AnalysisOwner.Transcode,
            transcodeId,
            FormatSection(formatId, formatLabel, children, integrity),
            cancellationToken);
    }

    // —— Tree sections ————————————————————————————————————————————————————

    private static AnalysisTreeNode FormatSection(
        string id,
        string label,
        List<AnalysisTreeNode> children,
        PackagingIntegrityDocument? integrity) =>
        integrity is { Passed: false }
            ? Section(
                id,
                label,
                TranscodeProbeSource,
                AnalysisSectionStatus.Failed,
                "Packaging integrity check failed: " + string.Join("; ", integrity.Problems.Take(3)),
                children)
            : Section(id, label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);

    private static List<AnalysisTreeNode> EncodingLeaves(string formatId, TranscodeProfile profile) => [
        Leaf(
            $"{formatId}.general.rate_control",
            "Rate control",
            $"2-pass VBR, maxrate {Transcoder.MaxrateFactor.ToString("0.##", CultureInfo.InvariantCulture)}× target, " +
            $"VBV buffer {Transcoder.BufsizeFactor.ToString("0.##", CultureInfo.InvariantCulture)}× target"),
        Leaf($"{formatId}.general.keyframes", "Keyframes", $"IDR forced every {profile.SegmentDurationSeconds} s"),
        Leaf($"{formatId}.general.encode", "Encoding", "Each rung encoded once, stream-copied into HLS and DASH")
    ];

    private AnalysisTreeNode BuildHlsGeneralSection(TranscodeProfile profile, string routeId, Guid transcodeId, int rungCount) {
        var masterExists = File.Exists(Path.Combine(_paths.HlsDir(routeId, transcodeId), MediaNames.HlsMaster));

        return Section("hls.general", "General", TranscodeProbeSource, AnalysisSectionStatus.Completed, children: [
            Leaf("hls.general.playlist", "Master playlist", $"hls/{MediaNames.HlsMaster}"),
            Leaf("hls.general.format", "Format", "HLS / fMP4, audio as a separate rendition group"),
            Leaf("hls.general.variants", "Variant count", Count(rungCount)),
            Leaf("hls.general.profile", "Transcode profile", profile.Name),
            Leaf("hls.general.master_present", "Master playlist present", masterExists ? "Yes" : "No"),
            .. EncodingLeaves("hls", profile)
        ]);
    }

    private AnalysisTreeNode BuildDashGeneralSection(
        TranscodeProfile profile,
        string routeId,
        Guid transcodeId,
        IReadOnlyList<DashRepresentation> representations) {
        var manifestPath = Path.Combine(_paths.DashDir(routeId, transcodeId), MediaNames.DashManifest);
        var children = new List<AnalysisTreeNode> {
            Leaf("dash.general.manifest", "Manifest", $"dash/{MediaNames.DashManifest}"),
            Leaf("dash.general.format", "Format", "MPEG-DASH / fMP4, audio as a separate adaptation set"),
            Leaf("dash.general.variants", "Variant count", Count(representations.Count(rep => rep.IsVideo))),
            Leaf("dash.general.profile", "Transcode profile", profile.Name),
            Leaf("dash.general.manifest_present", "Manifest present", File.Exists(manifestPath) ? "Yes" : "No"),
            Leaf("dash.general.reps_found", "Representations found", Count(representations.Count))
        };

        if (File.Exists(manifestPath)) {
            try {
                AddIfPresent(children, "dash.general.mpd_profiles", "MPD profiles", XDocument.Load(manifestPath).Root?.Attribute("profiles")?.Value);
            } catch {
                // Per-rung sections already report missing data; a bad MPD header is not worth failing on.
            }
        }

        children.AddRange(EncodingLeaves("dash", profile));
        return Section("dash.general", "General", TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static AnalysisTreeNode BuildHlsVariantSection(
        TranscodeVariant variant,
        TranscodeProfile profile,
        EncodedRung? rung,
        PackagingIntegrityRung? check) {
        var prefix = $"hls.{variant.Label}";
        var children = TargetLeaves(prefix, variant, profile, "playlist", "Media playlist", $"hls/{MediaNames.HlsPlaylist(variant.Label)}");

        if (rung == null) {
            children.Add(Leaf($"{prefix}.error", "Probe error", "Rendition was not encoded"));
            return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Failed, children: children);
        }

        AppendRenditionLeaves(children, prefix, rung);
        AddIfPresent(children, $"{prefix}.declared_bandwidth", "Declared BANDWIDTH", FormatBitrate(check?.HlsBandwidthBps));
        AddIfPresent(children, $"{prefix}.declared_average", "Declared AVERAGE-BANDWIDTH", FormatBitrate(check?.HlsAverageBandwidthBps));

        return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static AnalysisTreeNode BuildDashVariantSection(
        TranscodeVariant variant,
        TranscodeProfile profile,
        EncodedRung? rung,
        DashRepresentation? representation) {
        var prefix = $"dash.{variant.Label}";
        var children = TargetLeaves(prefix, variant, profile, "manifest", "Manifest", $"dash/{MediaNames.DashManifest}");

        if (representation == null) {
            children.Add(Leaf($"{prefix}.error", "Probe error", "Representation not found in MPD"));
            return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Failed, children: children);
        }

        children.Add(Leaf($"{prefix}.representation_id", "Representation ID", representation.RepresentationId));
        AddIfPresent(children, $"{prefix}.declared_bandwidth", "Declared @bandwidth", FormatBitrate(representation.Bandwidth));
        AddIfPresent(children, $"{prefix}.resolution", "Resolution", representation.Resolution);
        children.Add(Leaf($"{prefix}.codec", "Codec", representation.Codecs ?? profile.VideoCodec));
        AddIfPresent(children, $"{prefix}.init", "Init segment", representation.InitSegment != null ? $"dash/{representation.InitSegment}" : null);

        if (rung != null) {
            AddIfPresent(children, $"{prefix}.bitrate", "Video bit rate (measured)", FormatBitrate(rung.Rate?.AverageBps));
            AddIfPresent(children, $"{prefix}.peak_bitrate", "Peak segment bit rate", FormatBitrate(rung.Rate?.PeakSegmentBps));
        }

        return Section(prefix, variant.Label, TranscodeProbeSource, AnalysisSectionStatus.Completed, children: children);
    }

    private static void AppendRenditionLeaves(List<AnalysisTreeNode> children, string prefix, EncodedRung rung) {
        AddIfPresent(children, $"{prefix}.resolution", "Resolution", rung.Description?.Resolution);
        children.Add(Leaf($"{prefix}.codec", "Codec", rung.Description?.Codec ?? "H264"));
        AddIfPresent(children, $"{prefix}.duration", "Duration", FormatDuration(rung.Description?.DurationSec));
        AddIfPresent(children, $"{prefix}.bitrate", "Video bit rate (measured)", FormatBitrate(rung.Rate?.AverageBps));
        AddIfPresent(children, $"{prefix}.peak_bitrate", "Peak segment bit rate", FormatBitrate(rung.Rate?.PeakSegmentBps));
    }

    private static AnalysisTreeNode BuildIntegritySection(string formatId, PackagingIntegrityDocument integrity) {
        var hls = formatId == HlsId;
        var children = new List<AnalysisTreeNode>();

        foreach (var rung in integrity.Rungs) {
            var hash = hls ? rung.HlsSha256 : rung.DashSha256;
            var packets = hls ? rung.HlsPackets : rung.DashPackets;
            var segments = hls ? rung.HlsSegmentsSec : rung.DashSegmentsSec;
            var avDelta = hls ? rung.HlsAvDeltaMs : rung.DashAvDeltaMs;
            var bandwidth = hls ? rung.HlsBandwidthBps : rung.DashBandwidthBps;
            var prefix = $"{formatId}.integrity.{rung.Label}";

            children.Add(Leaf(
                $"{prefix}.bitstream",
                $"{rung.Label} video bitstream",
                hash == null
                    ? "not verified"
                    : hash == rung.RenditionSha256
                        ? $"identical to the encoded rendition (SHA-256 {hash[..12]}…)"
                        : $"differs from the encoded rendition ({hash[..12]}… vs {rung.RenditionSha256?[..12]}…)"));
            children.Add(Leaf($"{prefix}.packets", $"{rung.Label} video packets", packets?.ToString(CultureInfo.InvariantCulture) ?? "—"));
            children.Add(Leaf($"{prefix}.segments", $"{rung.Label} segments", DescribeSegments(segments)));
            children.Add(Leaf(
                $"{prefix}.av",
                $"{rung.Label} A/V offset change from packaging",
                avDelta is { } delta ? delta.ToString("+0.0;-0.0;0", CultureInfo.InvariantCulture) + " ms" : "—"));
            children.Add(Leaf($"{prefix}.bandwidth", $"{rung.Label} declared bandwidth (video + audio)", FormatBitrate(bandwidth) ?? "—"));
        }

        children.Add(Leaf(
            $"{formatId}.integrity.segment_tables",
            "Segment tables identical across rungs and protocols",
            integrity.SegmentTablesIdentical ? "Yes" : "No"));

        if (integrity.Problems.Count > 0) {
            children.Add(Leaf($"{formatId}.integrity.problems", "Problems", string.Join("; ", integrity.Problems)));
        }

        return Section(
            $"{formatId}.integrity",
            "Packaging integrity",
            "ffmpeg-streamhash",
            integrity.Passed ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
            integrity.Passed ? null : $"{integrity.Problems.Count} integrity problem(s)",
            children);
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
        IReadOnlyDictionary<string, SitiSeriesData> series,
        TranscodeProfile profile) {
        var children = new List<AnalysisTreeNode>();

        foreach (var variant in profile.Variants) {
            var found = series.TryGetValue(variant.Label, out var data);
            children.Add(Leaf(
                $"{formatId}.siti.{variant.Label}_avg_si",
                $"{variant.Label} Average SI",
                found && data!.Si.Count > 0 ? Stat(data.Si.Average()) : "—"));
            children.Add(Leaf(
                $"{formatId}.siti.{variant.Label}_avg_ti",
                $"{variant.Label} Average TI",
                found && data!.Ti.Count > 0 ? Stat(data.Ti.Average()) : "—"));
        }

        return Section(
            $"{formatId}.siti",
            "SI/TI (per rendition)",
            "ffmpeg-siti",
            series.Count > 0 ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Pending,
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
                    $"{variant.Label} Measured video bitrate",
                    FormatBitrate(summary.BitrateBps.Value)));
            }

            if (summary.TargetBitrateBps != null) {
                children.Add(Leaf(
                    $"{formatId}.vmaf.{variant.Label}_target_bitrate",
                    $"{variant.Label} Target bitrate",
                    FormatBitrate(summary.TargetBitrateBps.Value)));
            }
        }

        var status = summaries.Count > 0
            ? AnalysisSectionStatus.Completed
            : ranVmaf
                ? AnalysisSectionStatus.Failed
                : AnalysisSectionStatus.Pending;

        return Section($"{formatId}.vmaf", "VMAF (per rendition)", "ffmpeg-libvmaf", status, children: children);
    }

    // —— MPD parsing ——————————————————————————————————————————————————————

    private sealed record DashRepresentation(
        string Label,
        string RepresentationId,
        bool IsVideo,
        int? Height,
        long? Bandwidth,
        string? Resolution,
        string? Codecs,
        string? InitSegment,
        List<double>? SegmentDurations);

    private XDocument? LoadMpd(string routeId, Guid transcodeId) {
        var path = Path.Combine(_paths.DashDir(routeId, transcodeId), MediaNames.DashManifest);
        if (!File.Exists(path)) {
            return null;
        }

        try {
            return XDocument.Load(path);
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Could not parse MPD {Path}", path);
            return null;
        }
    }

    private static List<DashRepresentation> ParseDashRepresentations(XDocument? document, TranscodeProfile profile) {
        var results = new List<DashRepresentation>();
        if (document == null) {
            return results;
        }

        XNamespace ns = document.Root?.Name.NamespaceName ?? "urn:mpeg:dash:schema:mpd:2011";
        var videoIndex = 0;

        foreach (var representation in document.Descendants(ns + "Representation")) {
            var mime = representation.Attribute("mimeType")?.Value
                       ?? representation.Parent?.Attribute("mimeType")?.Value
                       ?? representation.Parent?.Attribute("contentType")?.Value
                       ?? "";
            var widthText = representation.Attribute("width")?.Value;
            var heightText = representation.Attribute("height")?.Value;
            var isVideo = mime.StartsWith("video", StringComparison.OrdinalIgnoreCase) || heightText != null;
            var id = representation.Attribute("id")?.Value ?? results.Count.ToString(CultureInfo.InvariantCulture);

            var template = representation.Element(ns + "SegmentTemplate") ?? representation.Parent?.Element(ns + "SegmentTemplate");
            var initSegment = template?.Attribute("initialization")?.Value
                ?.Replace("$RepresentationID$", id, StringComparison.Ordinal);

            int? height = int.TryParse(heightText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedHeight) ? parsedHeight : null;
            long? bandwidth = long.TryParse(representation.Attribute("bandwidth")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedBandwidth)
                ? parsedBandwidth
                : null;

            results.Add(new DashRepresentation(
                isVideo ? MatchVariantLabel(profile, height, videoIndex++) : MediaNames.HlsAudioName,
                id,
                isVideo,
                height,
                bandwidth,
                widthText != null && heightText != null ? $"{widthText}x{heightText}" : null,
                representation.Attribute("codecs")?.Value,
                initSegment,
                ReadTimeline(template, ns)));
        }

        return results;
    }

    /// <summary>Segment durations in seconds from a <c>SegmentTimeline</c>, with <c>@r</c> repeats expanded.</summary>
    private static List<double>? ReadTimeline(XElement? template, XNamespace ns) {
        var timeline = template?.Element(ns + "SegmentTimeline");
        if (template == null || timeline == null) {
            return null;
        }

        var timescale = double.TryParse(template.Attribute("timescale")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var scale) && scale > 0
            ? scale
            : 1;

        var durations = new List<double>();
        foreach (var entry in timeline.Elements(ns + "S")) {
            if (!long.TryParse(entry.Attribute("d")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var duration)) {
                continue;
            }

            var repeat = int.TryParse(entry.Attribute("r")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var r) && r > 0 ? r : 0;
            for (var i = 0; i <= repeat; i++) {
                durations.Add(Math.Round(duration / timescale, 6));
            }
        }

        return durations;
    }

    /// <summary>Maps an MPD representation back to a ladder rung by height, falling back to order.</summary>
    private static string MatchVariantLabel(TranscodeProfile profile, int? height, int indexFallback) {
        if (height != null) {
            var match = profile.Variants.FirstOrDefault(variant => ParseResolution(variant.Resolution)?.Height == height);
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
