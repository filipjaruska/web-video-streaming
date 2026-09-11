using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace WebWVideoStreamingAPI.Core;

public sealed record TranscodeVariant(string Resolution, string Bitrate, string Label);

/// <summary>
/// The encoder settings a ladder is built and packaged with. Everything that differs between the
/// generic and the animation-optimized run lives here, so the two runs differ in exactly one object.
/// </summary>
/// <remarks>
/// The same recipe drives the encode grid and the packaging of the ladder derived from it. That is
/// deliberate: rate-quality points measured under different encoder settings than the ones that
/// ship would describe a ladder nobody encodes.
/// </remarks>
public sealed record EncodeRecipe(string? Tune, bool Decimate, int[] CoarseCrfs) {
    public static readonly EncodeRecipe Default =
        new(Tune: null, Decimate: false, CoarseCrfs: [20, 24, 28, 32, 36, 40]);

    /// <summary>
    /// Animation settings: x264's own animation tune over the same CRF range as <see cref="Default"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The range used to be shifted upward on the assumption that flat cel-shaded areas stay
    /// watchable further up the CRF scale. The first full run disproved that: the tune cuts the
    /// bitrate at a given CRF by roughly a fifth, so reaching the same bitrate takes a <em>lower</em>
    /// CRF, and every animation rung — 1080p included — landed on the shifted range's lowest value
    /// with the hull still steeper than λ there. Sharing the default range also gives the
    /// tuned-versus-untuned comparison the most matched (resolution, CRF) pairs to join on, and the
    /// grid's boundary extension reaches below it wherever a tangent point needs it.
    /// </para>
    /// <para>
    /// <see cref="Decimate"/> is deliberately <c>false</c> despite animation being the obvious
    /// candidate for it. Dropping duplicate frames only saves bits if the output stays
    /// variable-rate — re-inserting them as CFR just hands x264 skip frames it was already coding
    /// for almost nothing — and variable-rate output was measured to shorten the stream (613 frames
    /// / 28.6 s against the source's 720 / 30.0 s, because a static tail decimates away entirely)
    /// and to scatter HLS segment durations across 5.6–7.2 s against a requested 6. Either effect
    /// alone would make this ladder non-comparable with the other two: unequal duration breaks the
    /// rate comparison, and unequal segmentation confounds the protocol and network tests that
    /// assume identical segmenting. The flag stays plumbed so the trade-off can be re-measured.
    /// </para>
    /// </remarks>
    public static readonly EncodeRecipe Animation =
        new(Tune: "animation", Decimate: false, CoarseCrfs: [20, 24, 28, 32, 36, 40]);
}

public sealed class TranscodeProfile {
    public string Name { get; init; } = "default";
    public IReadOnlyList<TranscodeVariant> Variants { get; init; } = Array.Empty<TranscodeVariant>();
    public string VideoCodec { get; init; } = "libx264";
    public string AudioCodec { get; init; } = "aac";
    public string AudioBitrate { get; init; } = "128k";
    public int SegmentDurationSeconds { get; init; } = 6;

    /// <summary>
    /// x264 <c>-tune</c> value, or null for the encoder's defaults. Null on the static and dynamic
    /// profiles, set on the animation one, so a tuned run is a profile
    /// change rather than an encoder change and packaging stays identical in every other respect.
    /// </summary>
    public string? Tune { get; init; }

    /// <summary>Drop near-duplicate frames before encoding — animation shot "on twos".</summary>
    public bool Decimate { get; init; }

    public static TranscodeProfile Default { get; } = new() {
        Name = "default",
        Variants = [
            new TranscodeVariant("1920:1080", "4500k", "1080p"),
            new TranscodeVariant("1280:720", "2500k", "720p"),
            new TranscodeVariant("854:480", "1200k", "480p"),
            new TranscodeVariant("640:360", "800k", "360p"),
            new TranscodeVariant("426:240", "400k", "240p")
        ]
    };

    public static int ParseBitrateKbps(string bitrate) => int.Parse(bitrate.TrimEnd('k', 'K'));

    /// <summary>The ladder as stored on the Transcode row for provenance.</summary>
    public string ToJson() {
        return System.Text.Json.JsonSerializer.Serialize(
            new {
                name = Name,
                videoCodec = VideoCodec,
                audioCodec = AudioCodec,
                audioBitrate = AudioBitrate,
                segmentDurationSeconds = SegmentDurationSeconds,
                maxrateFactor = Transcoder.MaxrateFactor,
                bufsizeFactor = Transcoder.BufsizeFactor,
                tune = Tune,
                variants = Variants.Select(variant => new {
                    label = variant.Label,
                    resolution = variant.Resolution,
                    bitrate = variant.Bitrate
                })
            },
            Analysis.AnalysisSchema.Json);
    }
}

public sealed class TranscodeResult {
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public List<string> GeneratedFiles { get; set; } = [];
}

/// <summary>A rung encoded once, ready to be stream-copied into every delivery format.</summary>
public sealed record EncodedRendition(TranscodeVariant Variant, string Path, VideoRateStats? Rate);

/// <summary>The audio track, encoded once per video and shared by every ladder and format.</summary>
public sealed record EncodedAudio(string Path, long AverageBps, long PeakBps);

public sealed class AudioEncodeResult {
    public bool Success { get; init; }
    public bool HasAudio { get; init; }
    public string? ErrorMessage { get; init; }
}

/// <summary>
/// Every ffmpeg invocation this app performs: rendition and grid encodes, the shared audio track,
/// HLS and DASH packaging, thumbnails and source normalization.
/// </summary>
/// <remarks>
/// Each ladder rung is encoded exactly once and then stream-copied into both HLS and DASH, so the
/// two protocols carry byte-identical video by construction. They used to be two independent
/// x264 runs, which made the claim that the protocols differ only in packaging untrue — and
/// neither run forced keyframes, so segments came out 5.1–7.0 s long and cut at different points
/// on every rung and in each protocol.
/// </remarks>
public sealed class Transcoder {
    /// <summary>
    /// VBV headroom above each rung's target. Packaging used to cap maxrate at the target itself —
    /// near-CBR — while the grid the ladder is predicted from is constant-quality; achieved VMAF then
    /// landed 0.4–2.6 below prediction, worst on hard scenes the cap starved. The same factors apply
    /// to every ladder, so rate control is not a difference between them.
    /// </summary>
    internal const double MaxrateFactor = 1.5;
    internal const double BufsizeFactor = 3.0;

    /// <summary>Shared by the grid and packaging, so predicted and shipped encodes use one preset.</summary>
    internal const string Preset = "medium";

    internal const string HlsAudioGroup = "aud";

    private readonly ProcessRunner _runner;
    private readonly ILogger<Transcoder> _logger;

    public Transcoder(ProcessRunner runner, ILogger<Transcoder> logger) {
        _runner = runner;
        _logger = logger;
    }

    // —— Shared encoder arguments —————————————————————————————————————————

    /// <summary>
    /// Forced IDR keyframes every segment duration, on every rung and in every encode.
    /// </summary>
    /// <remarks>
    /// Frame 144 at 23.976 fps sits at 6.006 s, so this forces 0, 144, 288… and both packagers,
    /// which cut at the first keyframe at or after each 6 s mark, land on the same frames on every
    /// rung. Scene-cut keyframes stay enabled: they can only fall before a boundary's forced key,
    /// never after it, so they cannot move a segment edge. The grid uses the same arguments because
    /// the forced GOP changes rate-distortion slightly, and the grid must predict the encoder that
    /// actually ships.
    /// </remarks>
    internal static string KeyframeArgs(int segmentSeconds) =>
        $@"-force_key_frames ""expr:gte(t,n_forced*{segmentSeconds.ToString(CultureInfo.InvariantCulture)})"" -forced-idr 1 ";

    /// <summary>The profile's <c>-tune</c> as an ffmpeg argument, or nothing when it has none.</summary>
    private static string TuneArg(string? tune) =>
        string.IsNullOrWhiteSpace(tune) ? "" : $"-tune {tune} ";

    /// <summary>Filters that run before scaling, as a chain prefix ending in a comma.</summary>
    /// <remarks>
    /// <para>
    /// <c>setpts=PTS-STARTPTS</c> is not cosmetic. Containers routinely carry a small non-zero
    /// video start time (an edit list, a seek offset), and encoding from one without zeroing it
    /// makes the encoder pad the head to cover the gap — a 120-frame source came back as a
    /// 121-frame rendition. That extra frame shifts the whole stream by one against the source, so
    /// every full-reference score afterwards is comparing frame N to frame N−1: measured 34.65 mean
    /// with 54 dead frames before, 92.27 with none after. It also keeps renditions frame-aligned
    /// with each other, which ABR switching depends on.
    /// </para>
    /// <para>
    /// No <c>setsar</c>: 854×480 and 426×240 are not exactly 16:9, and the scale filter keeps the
    /// display aspect by writing SARs of 1280:1281 and 640:639. Forcing square pixels made every
    /// rendition a different display shape, which the DASH muxer rightly refuses to put in one
    /// adaptation set.
    /// </para>
    /// <para>
    /// <c>mpdecimate</c> drops frames outright, which leaves gaps in the timeline that only
    /// <c>-fps_mode vfr</c> resolves correctly. The two always travel together.
    /// </para>
    /// </remarks>
    private static string PreScaleFilter(bool decimate) =>
        "setpts=PTS-STARTPTS," + (decimate ? "mpdecimate," : "");

    private static string FpsModeArg(bool decimate) =>
        decimate ? "-fps_mode vfr " : "";

    /// <summary>Everything a rendition's two passes share. Any difference between passes breaks x264's 2-pass.</summary>
    internal static string RenditionArguments(string inputPath, TranscodeVariant variant, TranscodeProfile profile) {
        var kbps = TranscodeProfile.ParseBitrateKbps(variant.Bitrate);
        var maxrate = (int)Math.Round(kbps * MaxrateFactor);
        var bufsize = (int)Math.Round(kbps * BufsizeFactor);

        return
            $@"-hide_banner -y -i ""{inputPath}"" -map 0:v:0 -an -sn -dn " +
            $@"-vf ""{PreScaleFilter(profile.Decimate)}scale={variant.Resolution}"" {FpsModeArg(profile.Decimate)}" +
            $@"-c:v {profile.VideoCodec} -preset {Preset} {TuneArg(profile.Tune)}-pix_fmt yuv420p " +
            $@"-b:v {kbps}k -maxrate {maxrate}k -bufsize {bufsize}k " +
            KeyframeArgs(profile.SegmentDurationSeconds);
    }

    // —— Encoding —————————————————————————————————————————————————————————

    /// <summary>
    /// Encodes one rung, video only, in two passes. The result is the exact bitstream both HLS and
    /// DASH will carry.
    /// </summary>
    public async Task<TranscodeResult> EncodeRenditionAsync(
        string inputPath,
        string outputPath,
        string workDirectory,
        TranscodeVariant variant,
        TranscodeProfile profile,
        TimeSpan timeout,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            EnsureParentDir(outputPath);
            Directory.CreateDirectory(workDirectory);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var common = RenditionArguments(inputPath, variant, profile);

            // The pass log is named relative to a per-rung working directory, which keeps rungs
            // from clobbering each other's statistics and avoids quoting a Windows path inside it.
            var first = await _runner.RunAsync(
                "ffmpeg",
                $"{common}-pass 1 -passlogfile x264 -f null -",
                workingDirectory: workDirectory,
                timeout: timeout,
                cancellationToken: cancellationToken);

            if (!first.Success) {
                return Failed(result, $"Pass 1 failed for {variant.Label}: {first.ErrorMessage}");
            }

            var second = await _runner.RunAsync(
                "ffmpeg",
                $@"{common}-pass 2 -passlogfile x264 -movflags +faststart ""{outputPath}""",
                workingDirectory: workDirectory,
                timeout: timeout,
                cancellationToken: cancellationToken);

            if (!second.Success || !File.Exists(outputPath)) {
                return Failed(result, $"Pass 2 failed for {variant.Label}: {second.ErrorMessage}");
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Rendition encode failed for {Label}", variant.Label);
            return Failed(result, ex.Message);
        } finally {
            TryDeleteDirectory(workDirectory);
        }

        return result;
    }

    /// <summary>
    /// Encodes the audio track once, shifted by the same start offset video is zeroed by.
    /// </summary>
    /// <remarks>
    /// Video is re-timed with <c>setpts=PTS-STARTPTS</c>; audio used to be encoded straight, so any
    /// difference between the two streams' start times — 17 ms on the Frieren master — became an
    /// A/V offset in every rendition. The track is shared by all three ladders, so it is encoded once.
    /// </remarks>
    public async Task<AudioEncodeResult> EncodeAudioAsync(
        string sourcePath,
        string outputPath,
        string audioBitrate,
        CancellationToken cancellationToken = default) {
        try {
            RequireInput(sourcePath);
            EnsureParentDir(outputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var (videoStart, audioStart) = await ProbeStartTimesAsync(sourcePath, cancellationToken);
            if (audioStart == null) {
                return new AudioEncodeResult { Success = true, HasAudio = false };
            }

            var offset = audioStart.Value - (videoStart ?? 0);
            var filter = Math.Abs(offset) < 0.001
                ? "asetpts=PTS-STARTPTS"
                : offset > 0
                    ? $"adelay=delays={Math.Round(offset * 1000).ToString(CultureInfo.InvariantCulture)}:all=1,asetpts=PTS-STARTPTS"
                    : $"asetpts=PTS-STARTPTS,atrim=start={(-offset).ToString("0.######", CultureInfo.InvariantCulture)},asetpts=PTS-STARTPTS";

            var run = await _runner.RunAsync(
                "ffmpeg",
                $@"-hide_banner -y -i ""{sourcePath}"" -map 0:a:0 -vn -sn -dn -af ""{filter}"" " +
                $@"-c:a aac -b:a {audioBitrate} -ac 2 -ar 48000 ""{outputPath}""",
                timeout: TimeSpan.FromMinutes(15),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(outputPath)) {
                return new AudioEncodeResult { Success = false, HasAudio = true, ErrorMessage = run.ErrorMessage ?? "Audio encode failed" };
            }

            _logger.LogInformation("Encoded shared audio for {Source} with offset {Offset:0.###} s", sourcePath, offset);
            return new AudioEncodeResult { Success = true, HasAudio = true };
        } catch (Exception ex) {
            _logger.LogError(ex, "Audio encode failed for {Source}", sourcePath);
            return new AudioEncodeResult { Success = false, HasAudio = true, ErrorMessage = ex.Message };
        }
    }

    /// <summary>Encodes a single MP4 at a resolution + CRF for encode-grid RD sampling.</summary>
    /// <remarks>
    /// Identical to a packaging rendition in everything but rate control — same filters, preset,
    /// tune and forced keyframes — because the grid exists to predict the encoder that ships.
    /// </remarks>
    public async Task<TranscodeResult> EncodeCrfAsync(
        string inputPath,
        string outputPath,
        string resolution,
        int crf,
        EncodeRecipe? recipe = null,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            EnsureParentDir(outputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            recipe ??= EncodeRecipe.Default;

            var args =
                $@"-hide_banner -y -i ""{inputPath}"" -map 0:v:0 -an -sn -dn " +
                $@"-vf ""{PreScaleFilter(recipe.Decimate)}scale={resolution}"" {FpsModeArg(recipe.Decimate)}" +
                $@"-c:v libx264 -crf {crf} -preset {Preset} {TuneArg(recipe.Tune)}-pix_fmt yuv420p " +
                KeyframeArgs(TranscodeProfile.Default.SegmentDurationSeconds) +
                $@"""{outputPath}""";

            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(30),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(outputPath)) {
                return Failed(result, run.ErrorMessage ?? run.StdErr ?? "CRF encode failed");
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed CRF encode for {InputPath} crf={Crf}", inputPath, crf);
            return Failed(result, ex.Message);
        }

        return result;
    }

    // —— Packaging ————————————————————————————————————————————————————————

    /// <summary>
    /// Packages the encoded renditions as HLS with fMP4 segments, by stream copy, in one ffmpeg
    /// invocation with the audio as a separate rendition group.
    /// </summary>
    /// <remarks>
    /// One invocation, not one per rung: ffmpeg shifts timestamps per output to keep decode times
    /// non-negative, and B-frames start video 83 ms before zero while audio does not, so muxing
    /// them in separate processes would skew A/V by that much. A separate audio group mirrors DASH's
    /// separate audio adaptation set, so on both protocols a video segment download — the thing a
    /// throughput estimate is taken from — carries video alone.
    /// </remarks>
    public async Task<TranscodeResult> PackageHlsAsync(
        IReadOnlyList<EncodedRendition> renditions,
        EncodedAudio? audio,
        string hlsDir,
        TranscodeProfile profile,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            Directory.CreateDirectory(hlsDir);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var args = new StringBuilder("-hide_banner -y ");
            AppendInputsAndMaps(args, renditions, audio);
            args.Append("-c copy -f hls ");
            args.Append($"-hls_time {profile.SegmentDurationSeconds} -hls_playlist_type vod -hls_list_size 0 ");
            args.Append("-hls_segment_type fmp4 -hls_flags independent_segments ");
            args.Append($@"-hls_fmp4_init_filename ""{MediaNames.HlsInitTemplate}"" ");
            args.Append($@"-hls_segment_filename ""{MediaNames.HlsSegmentTemplate}"" ");

            var streams = renditions
                .Select((rendition, index) => audio != null
                    ? $"v:{index},agroup:{HlsAudioGroup},name:{rendition.Variant.Label}"
                    : $"v:{index},name:{rendition.Variant.Label}")
                .ToList();

            if (audio != null) {
                streams.Add($"a:0,agroup:{HlsAudioGroup},name:{MediaNames.HlsAudioName},default:yes");
            }

            args.Append($@"-var_stream_map ""{string.Join(" ", streams)}"" ");
            args.Append($@"""{MediaNames.HlsVariantTemplate}""");

            var run = await _runner.RunAsync(
                "ffmpeg",
                args.ToString(),
                workingDirectory: hlsDir,
                timeout: TimeSpan.FromMinutes(15),
                cancellationToken: cancellationToken);

            if (!run.Success) {
                return Failed(result, run.ErrorMessage ?? "HLS packaging failed");
            }

            await WriteHlsMasterPlaylistAsync(hlsDir, renditions, audio, cancellationToken);
            result.GeneratedFiles.Add(MediaNames.HlsMaster);
            _logger.LogInformation("Packaged HLS (fMP4) in {Dir}", hlsDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "HLS packaging failed in {Dir}", hlsDir);
            return Failed(result, ex.Message);
        }

        return result;
    }

    /// <summary>Packages the same encoded renditions as DASH, by stream copy, in one invocation.</summary>
    public async Task<TranscodeResult> PackageDashAsync(
        IReadOnlyList<EncodedRendition> renditions,
        EncodedAudio? audio,
        string dashDir,
        TranscodeProfile profile,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            Directory.CreateDirectory(dashDir);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var args = new StringBuilder("-hide_banner -y ");
            AppendInputsAndMaps(args, renditions, audio);
            args.Append("-c copy -f dash ");
            args.Append($"-seg_duration {profile.SegmentDurationSeconds} -use_template 1 -use_timeline 1 ");
            args.Append(audio != null
                ? @"-adaptation_sets ""id=0,streams=v id=1,streams=a"" "
                : @"-adaptation_sets ""id=0,streams=v"" ");
            args.Append($@"-init_seg_name ""{MediaNames.DashInitTemplate}"" ");
            args.Append($@"-media_seg_name ""{MediaNames.DashSegmentTemplate}"" ");
            args.Append($@"""{MediaNames.DashManifest}""");

            var run = await _runner.RunAsync(
                "ffmpeg",
                args.ToString(),
                workingDirectory: dashDir,
                timeout: TimeSpan.FromMinutes(15),
                cancellationToken: cancellationToken);

            if (!run.Success) {
                return Failed(result, run.ErrorMessage ?? "DASH packaging failed");
            }

            DeclareDashBandwidths(Path.Combine(dashDir, MediaNames.DashManifest), renditions, audio);
            result.GeneratedFiles.Add(MediaNames.DashManifest);
            _logger.LogInformation("Packaged DASH in {Dir}", dashDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "DASH packaging failed in {Dir}", dashDir);
            return Failed(result, ex.Message);
        }

        return result;
    }

    private static void AppendInputsAndMaps(StringBuilder args, IReadOnlyList<EncodedRendition> renditions, EncodedAudio? audio) {
        foreach (var rendition in renditions) {
            args.Append($@"-i ""{rendition.Path}"" ");
        }

        if (audio != null) {
            args.Append($@"-i ""{audio.Path}"" ");
        }

        for (var i = 0; i < renditions.Count; i++) {
            args.Append($"-map {i}:v:0 ");
        }

        if (audio != null) {
            args.Append($"-map {renditions.Count}:a:0 ");
        }
    }

    /// <summary>
    /// The bandwidth a rung declares, identically on both protocols: measured per-segment peak and
    /// average of the video, plus the audio's.
    /// </summary>
    /// <remarks>
    /// The ABR rules compare these against measured throughput, so the two protocols must declare
    /// the same numbers or the protocol comparison measures a difference in labels. They used not
    /// to: the HLS master wrote target + 128k while the MPD carried the bare target, 21 % apart at
    /// 240p. Falls back to the target × maxrate factor only when the rendition could not be measured.
    /// </remarks>
    internal static (long Peak, long Average) DeclaredVideoBandwidth(EncodedRendition rendition) {
        var target = TranscodeProfile.ParseBitrateKbps(rendition.Variant.Bitrate) * 1000L;
        var peak = rendition.Rate?.PeakSegmentBps is > 0 ? rendition.Rate.PeakSegmentBps : (long)(target * MaxrateFactor);
        var average = rendition.Rate?.AverageBps is > 0 ? rendition.Rate.AverageBps : target;
        return (peak, average);
    }

    private async Task WriteHlsMasterPlaylistAsync(
        string hlsDir,
        IReadOnlyList<EncodedRendition> renditions,
        EncodedAudio? audio,
        CancellationToken cancellationToken) {
        var version = ReadPlaylistVersion(Path.Combine(hlsDir, MediaNames.HlsPlaylist(renditions[0].Variant.Label))) ?? 7;
        var audioInfo = audio != null ? await ProbeStreamAsync(audio.Path, cancellationToken) : null;

        var lines = new List<string> {
            "#EXTM3U",
            $"#EXT-X-VERSION:{version}",
            "#EXT-X-INDEPENDENT-SEGMENTS"
        };

        if (audio != null) {
            lines.Add(
                $"#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"{HlsAudioGroup}\",NAME=\"audio\",LANGUAGE=\"und\"," +
                $"DEFAULT=YES,AUTOSELECT=YES,CHANNELS=\"2\",URI=\"{MediaNames.HlsAudioPlaylist}\"");
        }

        foreach (var rendition in renditions) {
            var info = await ProbeStreamAsync(rendition.Path, cancellationToken);
            var (videoPeak, videoAverage) = DeclaredVideoBandwidth(rendition);

            var attributes = new List<string> {
                $"BANDWIDTH={videoPeak + (audio?.PeakBps ?? 0)}",
                $"AVERAGE-BANDWIDTH={videoAverage + (audio?.AverageBps ?? 0)}",
                $"RESOLUTION={(info?.Width is { } width && info.Height is { } height ? $"{width}x{height}" : rendition.Variant.Resolution.Replace(':', 'x'))}"
            };

            if (info?.FrameRate is { } frameRate) {
                attributes.Add($"FRAME-RATE={frameRate.ToString("0.000", CultureInfo.InvariantCulture)}");
            }

            // RFC 8216 says CODECS SHOULD be present, and Safari needs the audio codec listed too
            // when an audio group is used. Omitted rather than guessed if the probe fails.
            var codecs = new[] { info?.Codec, audioInfo?.Codec }.Where(codec => codec != null).ToList();
            if (codecs.Count > 0) {
                attributes.Add($"CODECS=\"{string.Join(",", codecs)}\"");
            }

            if (audio != null) {
                attributes.Add($"AUDIO=\"{HlsAudioGroup}\"");
            }

            lines.Add($"#EXT-X-STREAM-INF:{string.Join(",", attributes)}");
            lines.Add(MediaNames.HlsPlaylist(rendition.Variant.Label));
        }

        await File.WriteAllLinesAsync(Path.Combine(hlsDir, MediaNames.HlsMaster), lines, cancellationToken);
    }

    private static int? ReadPlaylistVersion(string playlistPath) {
        if (!File.Exists(playlistPath)) {
            return null;
        }

        var match = Regex.Match(File.ReadAllText(playlistPath), @"#EXT-X-VERSION:(\d+)");
        return match.Success ? int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) : null;
    }

    /// <summary>
    /// Rewrites each representation's <c>@bandwidth</c> to the same measured values the HLS master
    /// declares. Under stream copy ffmpeg writes the track average, not a peak.
    /// </summary>
    private static void DeclareDashBandwidths(
        string manifestPath,
        IReadOnlyList<EncodedRendition> renditions,
        EncodedAudio? audio) {
        if (!File.Exists(manifestPath)) {
            return;
        }

        var document = XDocument.Load(manifestPath);
        XNamespace ns = document.Root?.Name.NamespaceName ?? "urn:mpeg:dash:schema:mpd:2011";

        foreach (var representation in document.Descendants(ns + "Representation")) {
            var mime = representation.Attribute("mimeType")?.Value ?? representation.Parent?.Attribute("mimeType")?.Value ?? "";

            if (mime.StartsWith("audio", StringComparison.OrdinalIgnoreCase)) {
                if (audio != null) {
                    representation.SetAttributeValue("bandwidth", audio.PeakBps);
                }

                continue;
            }

            if (!int.TryParse(representation.Attribute("height")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var height)) {
                continue;
            }

            var rendition = renditions.FirstOrDefault(item =>
                Analysis.MediaFormatting.ParseResolution(item.Variant.Resolution)?.Height == height);
            if (rendition != null) {
                representation.SetAttributeValue("bandwidth", DeclaredVideoBandwidth(rendition).Peak);
            }
        }

        document.Save(manifestPath);
    }

    // —— Source and thumbnail ————————————————————————————————————————————

    public async Task<TranscodeResult> ExtractThumbnailAsync(
        string inputPath,
        string outputPath,
        double atSeconds = 1,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);
            EnsureParentDir(outputPath);

            var seek = atSeconds.ToString(CultureInfo.InvariantCulture);
            // Scale down for list/cards and encode WebP (~tens of KB vs ~1MB near-lossless JPEG).
            var args =
                $@"-y -ss {seek} -i ""{inputPath}"" -frames:v 1 -vf ""scale='min(720,iw)':-2"" -c:v libwebp -quality 85 ""{outputPath}""";

            _logger.LogInformation("Extracting thumbnail from {InputPath} at {AtSeconds}s", inputPath, atSeconds);

            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(1),
                cancellationToken: cancellationToken);

            if (!run.Success) {
                return Failed(result, run.ErrorMessage ?? $"FFmpeg failed: {run.StdErr}");
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to extract thumbnail from {InputPath}", inputPath);
            return Failed(result, ex.Message);
        }

        return result;
    }

    /// <summary>
    /// Rewrites the upload as a faststart MP4 in place, copying both bitstreams so the result is
    /// bit-identical to what was uploaded. Browsers cannot play Matroska, and a non-faststart MP4
    /// cannot be seeked before it is fully buffered, so progressive "source" playback needs this.
    /// </summary>
    /// <remarks>
    /// Returns false and leaves the original untouched when the streams cannot live in MP4 (ffmpeg
    /// rejects the copy). Everything else in the pipeline still works in that case — only
    /// progressive playback of the original is unavailable.
    /// </remarks>
    public async Task<bool> NormalizeSourceAsync(string sourcePath, CancellationToken cancellationToken = default) {
        var directory = Path.GetDirectoryName(sourcePath)!;
        var tempPath = Path.Combine(directory, "source.normalizing.mp4");

        try {
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            // `-map 0:a:0?` tolerates a video with no audio; -sn/-dn drop subtitle and data
            // tracks, which MP4 cannot carry (subtitles are served as separate VTT side-cars).
            // `-map_chapters -1` matters too: the MP4 muxer turns Matroska chapters into an empty
            // text track that would otherwise show up as a bogus subtitle track in the player.
            var args =
                $@"-y -i ""{sourcePath}"" " +
                $@"-map 0:v:0 -map 0:a:0? " +
                $@"-c copy -sn -dn -map_chapters -1 " +
                $@"-movflags +faststart " +
                $@"""{tempPath}""";

            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(15),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(tempPath) || new FileInfo(tempPath).Length == 0) {
                _logger.LogWarning(
                    "Source normalization skipped for {Path}: {Error}",
                    sourcePath,
                    run.ErrorMessage ?? run.StdErr);
                return false;
            }

            File.Move(tempPath, sourcePath, overwrite: true);
            _logger.LogInformation("Normalized source to faststart MP4: {Path}", sourcePath);
            return true;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Source normalization failed for {Path}", sourcePath);
            return false;
        } finally {
            if (File.Exists(tempPath)) {
                try {
                    File.Delete(tempPath);
                } catch {
                    // Best-effort cleanup of the half-written remux.
                }
            }
        }
    }

    // —— Probing ——————————————————————————————————————————————————————————

    private sealed record StreamInfo(string? Codec, double? FrameRate, int? Width, int? Height);

    private async Task<(double? Video, double? Audio)> ProbeStartTimesAsync(string path, CancellationToken cancellationToken) {
        var run = await _runner.RunAsync(
            "ffprobe",
            $@"-v error -show_entries stream=codec_type,start_time -of json ""{path}""",
            timeout: TimeSpan.FromMinutes(1),
            cancellationToken: cancellationToken);

        if (!run.Success || string.IsNullOrWhiteSpace(run.StdOut)) {
            return (null, null);
        }

        using var document = JsonDocument.Parse(run.StdOut);
        double? video = null;
        double? audio = null;

        if (document.RootElement.TryGetProperty("streams", out var streams)) {
            foreach (var stream in streams.EnumerateArray()) {
                var type = stream.TryGetProperty("codec_type", out var t) ? t.GetString() : null;
                var start = stream.TryGetProperty("start_time", out var s) &&
                            double.TryParse(s.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : 0;

                if (type == "video" && video == null) {
                    video = start;
                } else if (type == "audio" && audio == null) {
                    audio = start;
                }
            }
        }

        return (video, audio);
    }

    private static readonly Dictionary<string, int> H264ProfileIds = new(StringComparer.OrdinalIgnoreCase) {
        ["Constrained Baseline"] = 0x42,
        ["Baseline"] = 0x42,
        ["Main"] = 0x4D,
        ["High"] = 0x64,
        ["High 10"] = 0x6E
    };

    /// <summary>
    /// The RFC 6381 codec string, frame rate and dimensions of a file's first stream, read back off
    /// the encoded output rather than inferred, so the manifest always matches reality.
    /// </summary>
    private async Task<StreamInfo?> ProbeStreamAsync(string path, CancellationToken cancellationToken) {
        if (!File.Exists(path)) {
            return null;
        }

        try {
            var run = await _runner.RunAsync(
                "ffprobe",
                $"-v quiet -print_format json -show_streams \"{path}\"",
                timeout: TimeSpan.FromMinutes(1),
                cancellationToken: cancellationToken);

            if (!run.Success || string.IsNullOrWhiteSpace(run.StdOut)) {
                return null;
            }

            using var doc = JsonDocument.Parse(run.StdOut);
            if (!doc.RootElement.TryGetProperty("streams", out var streams)) {
                return null;
            }

            foreach (var stream in streams.EnumerateArray()) {
                var type = stream.TryGetProperty("codec_type", out var t) ? t.GetString() : null;
                var name = stream.TryGetProperty("codec_name", out var n) ? n.GetString() : null;
                var profileName = stream.TryGetProperty("profile", out var p) ? p.GetString() : null;

                switch (type) {
                    case "video":
                        return new StreamInfo(
                            BuildAvcCodec(name, profileName, stream),
                            ParseFrameRate(stream.TryGetProperty("r_frame_rate", out var rate) ? rate.GetString() : null),
                            stream.TryGetProperty("width", out var w) && w.TryGetInt32(out var width) ? width : null,
                            stream.TryGetProperty("height", out var h) && h.TryGetInt32(out var height) ? height : null);

                    case "audio" when name == "aac":
                        return new StreamInfo(
                            profileName switch {
                                "HE-AACv2" => "mp4a.40.29",
                                "HE-AAC" => "mp4a.40.5",
                                _ => "mp4a.40.2"
                            },
                            null,
                            null,
                            null);
                }
            }

            return null;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Could not probe streams for {Path}", path);
            return null;
        }
    }

    private static double? ParseFrameRate(string? rate) {
        if (string.IsNullOrWhiteSpace(rate)) {
            return null;
        }

        var parts = rate.Split('/');
        if (parts.Length == 2 &&
            double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var numerator) &&
            double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var denominator) &&
            denominator > 0) {
            return numerator / denominator;
        }

        return double.TryParse(rate, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : null;
    }

    /// <summary>RFC 6381 `avc1.PPCCLL` — profile id, constraint flags, level, as hex.</summary>
    private static string? BuildAvcCodec(string? codecName, string? profileName, JsonElement stream) {
        if (codecName != "h264" || profileName == null) {
            return null;
        }

        if (!H264ProfileIds.TryGetValue(profileName, out var profileId)) {
            return null;
        }

        if (!stream.TryGetProperty("level", out var levelElement) ||
            !levelElement.TryGetInt32(out var level) ||
            level <= 0) {
            return null;
        }

        // Constrained Baseline sets the constraint_set1 flag; every other profile leaves it clear.
        var constraints = profileName.StartsWith("Constrained", StringComparison.OrdinalIgnoreCase) ? 0xE0 : 0x00;

        return $"avc1.{profileId:X2}{constraints:X2}{level:X2}".ToLowerInvariant();
    }

    // —— Helpers ——————————————————————————————————————————————————————————

    private static TranscodeResult Failed(TranscodeResult result, string message) {
        result.Success = false;
        result.ErrorMessage = message;
        return result;
    }

    private void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path)) {
                Directory.Delete(path, recursive: true);
            }
        } catch (Exception ex) {
            _logger.LogDebug(ex, "Could not remove work directory {Path}", path);
        }
    }

    private static void RequireInput(string inputPath) {
        if (!File.Exists(inputPath)) {
            throw new FileNotFoundException($"Input video not found: {inputPath}");
        }
    }

    private static void EnsureParentDir(string outputPath) {
        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(dir)) {
            Directory.CreateDirectory(dir);
        }
    }
}
