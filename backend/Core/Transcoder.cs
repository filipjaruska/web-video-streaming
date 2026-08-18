using System.Globalization;
using System.Text;
using System.Text.Json;

namespace WebWVideoStreamingAPI.Core;

public sealed record TranscodeVariant(string Resolution, string Bitrate, string Label);

public sealed class TranscodeProfile {
    public string Name { get; init; } = "default";
    public IReadOnlyList<TranscodeVariant> Variants { get; init; } = Array.Empty<TranscodeVariant>();
    public string VideoCodec { get; init; } = "libx264";
    public string AudioCodec { get; init; } = "aac";
    public string AudioBitrate { get; init; } = "128k";
    public int SegmentDurationSeconds { get; init; } = 6;

    /// <summary>
    /// x264 <c>-tune</c> value, or null for the encoder's defaults. Null on both shipped profiles;
    /// the hook exists so the animation-tuned run (thesis 4.3.1.3 / 4.4.3) becomes a profile change
    /// rather than an encoder change, and so packaging stays identical in every other respect.
    /// </summary>
    public string? Tune { get; init; }

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

/// <summary>Every ffmpeg encode this app performs: HLS, DASH, thumbnails, and CRF grid samples.</summary>
public sealed class Transcoder {
    private readonly ProcessRunner _runner;
    private readonly ILogger<Transcoder> _logger;

    public Transcoder(ProcessRunner runner, ILogger<Transcoder> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<TranscodeResult> GenerateHlsAsync(
        string inputPath,
        string outputDir,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };
        profile ??= TranscodeProfile.Default;

        try {
            RequireInput(inputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            _logger.LogInformation("Starting HLS generation for {InputPath} with profile {Profile}", inputPath, profile.Name);

            var variantResults = await Task.WhenAll(profile.Variants.Select(variant =>
                GenerateHlsVariantAsync(inputPath, outputDir, variant, profile, cancellationToken)));

            var failures = variantResults.Where(item => !item.Success).ToList();
            if (failures.Count > 0) {
                result.Success = false;
                result.ErrorMessage = string.Join("; ", failures.Select(item => item.ErrorMessage));
                return result;
            }

            await WriteHlsMasterPlaylistAsync(outputDir, profile, cancellationToken);
            result.GeneratedFiles.Add(MediaNames.HlsMaster);

            _logger.LogInformation("Successfully generated HLS streams in {OutputDir}", outputDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate HLS for {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    public async Task<TranscodeResult> GenerateDashAsync(
        string inputPath,
        string outputDir,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };
        profile ??= TranscodeProfile.Default;

        try {
            RequireInput(inputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var args = new StringBuilder();
            args.Append($@"-y -i ""{inputPath}"" ");

            var filterComplex = profile.Variants
                .Select((variant, index) => $"[0:v]scale={variant.Resolution}[v{index}]");
            args.Append($@"-filter_complex ""{string.Join(";", filterComplex)}"" ");

            for (var i = 0; i < profile.Variants.Count; i++) {
                var variant = profile.Variants[i];
                var bitrateKbps = TranscodeProfile.ParseBitrateKbps(variant.Bitrate);
                args.Append($@"-map ""[v{i}]"" ");
                args.Append($@"-c:v:{i} {profile.VideoCodec} {TuneArg(profile)}-b:v:{i} {variant.Bitrate} -maxrate:{i} {variant.Bitrate} -bufsize:{i} {bitrateKbps * 2}k ");
            }

            // Single stereo audio AdaptationSet (matches HLS). Mapping audio per rung produces
            // broken multi-AS MPDs and preserves 5.1 that MSE rejects.
            args.Append(@"-map 0:a:0? ");
            args.Append($@"-c:a:0 {profile.AudioCodec} -b:a:0 {profile.AudioBitrate} -ac 2 ");

            args.Append(@"-f dash ");
            args.Append($@"-seg_duration {profile.SegmentDurationSeconds} ");
            args.Append(@"-use_template 1 ");
            args.Append(@"-use_timeline 1 ");
            args.Append(@"-adaptation_sets ""id=0,streams=v id=1,streams=a"" ");
            args.Append($@"-init_seg_name ""{MediaNames.DashInitTemplate}"" ");
            args.Append($@"-media_seg_name ""{MediaNames.DashSegmentTemplate}"" ");
            args.Append($@"""{MediaNames.DashManifest}""");

            _logger.LogInformation("Starting DASH generation for {InputPath} with profile {Profile}", inputPath, profile.Name);

            var run = await _runner.RunAsync(
                "ffmpeg",
                args.ToString(),
                workingDirectory: outputDir,
                cancellationToken: cancellationToken);

            if (!run.Success) {
                result.Success = false;
                result.ErrorMessage = run.ErrorMessage ?? $"FFmpeg failed: {run.StdErr}";
                return result;
            }

            result.GeneratedFiles.Add(MediaNames.DashManifest);
            result.GeneratedFiles.AddRange(
                Directory.GetFiles(outputDir, "*.m4s").Select(Path.GetFileName).OfType<string>());

            _logger.LogInformation("Successfully generated DASH streams in {OutputDir}", outputDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate DASH for {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

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
                result.Success = false;
                result.ErrorMessage = run.ErrorMessage ?? $"FFmpeg failed: {run.StdErr}";
                return result;
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to extract thumbnail from {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    /// <summary>
    /// The profile's <c>-tune</c> as an ffmpeg argument, or nothing when it has none. Trailing
    /// space included so call sites read the same whether a tune is set or not.
    /// </summary>
    private static string TuneArg(TranscodeProfile profile) =>
        string.IsNullOrWhiteSpace(profile.Tune) ? "" : $"-tune {profile.Tune} ";

    /// <summary>Encodes a single MP4 at a resolution + CRF for encode-grid RD sampling (not HLS/DASH).</summary>
    public async Task<TranscodeResult> EncodeCrfAsync(
        string inputPath,
        string outputPath,
        string resolution,
        int crf,
        string preset = "medium",
        string? tune = null,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            EnsureParentDir(outputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            // Video-only CRF sample — audio omitted to speed encode-grid sweeps. The tune must match
            // whatever the ladder will eventually be packaged with, or the RD points describe a
            // different encoder than the one that ships.
            var tuneArg = string.IsNullOrWhiteSpace(tune) ? "" : $"-tune {tune} ";
            var args =
                $@"-y -i ""{inputPath}"" " +
                $@"-vf scale={resolution} " +
                $@"-c:v libx264 -crf {crf} -preset {preset} {tuneArg}-pix_fmt yuv420p " +
                $@"-an ""{outputPath}""";

            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(30),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(outputPath)) {
                result.Success = false;
                result.ErrorMessage = run.ErrorMessage ?? run.StdErr ?? "CRF encode failed";
                return result;
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed CRF encode for {InputPath} crf={Crf}", inputPath, crf);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    /// <summary>
    /// Concatenates the given time ranges of the source into one short clip, used as both the input
    /// and the VMAF reference for the encode grid.
    /// </summary>
    /// <remarks>
    /// CRF 0 in yuv420p is mathematically lossless, and the source has already been normalized to
    /// 8-bit yuv420p by <see cref="NormalizeSourceAsync"/>, so the excerpt carries exactly the
    /// pixels the grid would have seen in the full clip. Anything lossy here would silently bias
    /// every VMAF score measured against it.
    /// </remarks>
    public async Task<TranscodeResult> ExtractWindowsAsync(
        string inputPath,
        string outputPath,
        IReadOnlyList<(double StartSec, double EndSec)> windows,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            EnsureParentDir(outputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var select = string.Join("+", windows.Select(window =>
                $"between(t,{Seconds(window.StartSec)},{Seconds(window.EndSec)})"));

            // setpts closes the gaps the dropped frames leave behind, so the excerpt plays as one
            // continuous clip with a monotonic timeline.
            var args =
                $@"-y -i ""{inputPath}"" " +
                $@"-vf ""select='{select}',setpts=N/FRAME_RATE/TB"" " +
                $@"-c:v libx264 -crf 0 -preset veryfast -pix_fmt yuv420p " +
                $@"-an ""{outputPath}""";

            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(30),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(outputPath)) {
                result.Success = false;
                result.ErrorMessage = run.ErrorMessage ?? run.StdErr ?? "Window extraction failed";
                return result;
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to extract complexity windows from {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;

        static string Seconds(double value) =>
            value.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>Remuxes a packaged HLS rendition into a plain MP4 so it can be probed and scored.</summary>
    public async Task<TranscodeResult> RemuxAsync(
        string inputPath,
        string outputPath,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            var run = await _runner.RunAsync(
                "ffmpeg",
                $@"-y -i ""{inputPath}"" -c copy ""{outputPath}""",
                workingDirectory: Path.GetDirectoryName(inputPath),
                timeout: TimeSpan.FromMinutes(10),
                cancellationToken: cancellationToken);

            if (!run.Success || !File.Exists(outputPath)) {
                result.Success = false;
                result.ErrorMessage = run.ErrorMessage ?? run.StdErr;
                return result;
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
        } catch (Exception ex) {
            result.Success = false;
            result.ErrorMessage = ex.Message;
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

    private async Task<TranscodeResult> GenerateHlsVariantAsync(
        string inputPath,
        string outputDir,
        TranscodeVariant variant,
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        var result = new TranscodeResult();
        var segmentPattern = Path.Combine(outputDir, MediaNames.HlsSegmentPattern(variant.Label));
        var playlistPath = Path.Combine(outputDir, MediaNames.HlsPlaylist(variant.Label));
        var bitrateKbps = TranscodeProfile.ParseBitrateKbps(variant.Bitrate);

        var args = $@"-y -i ""{inputPath}"" " +
            $@"-vf scale={variant.Resolution} " +
            $@"-c:v {profile.VideoCodec} {TuneArg(profile)}-b:v {variant.Bitrate} -maxrate {variant.Bitrate} -bufsize {bitrateKbps * 2}k " +
            $@"-c:a {profile.AudioCodec} -b:a {profile.AudioBitrate} -ac 2 " +
            $@"-f hls " +
            $@"-hls_time {profile.SegmentDurationSeconds} " +
            $@"-hls_list_size 0 " +
            $@"-hls_segment_filename ""{segmentPattern}"" " +
            $@"""{playlistPath}""";

        try {
            var run = await _runner.RunAsync(
                "ffmpeg",
                args,
                timeout: TimeSpan.FromMinutes(5),
                cancellationToken: cancellationToken);

            if (!run.Success) {
                result.Success = false;
                result.ErrorMessage = $"FFmpeg failed for {variant.Label}: {run.StdErr}";
            } else {
                result.Success = true;
                result.GeneratedFiles.Add(MediaNames.HlsPlaylist(variant.Label));
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Exception while generating HLS variant {Name}", variant.Label);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    private async Task WriteHlsMasterPlaylistAsync(
        string outputDir,
        TranscodeProfile profile,
        CancellationToken cancellationToken) {
        var masterPath = Path.Combine(outputDir, MediaNames.HlsMaster);
        var audioBitrateBps = TranscodeProfile.ParseBitrateKbps(profile.AudioBitrate) * 1000;

        var lines = new List<string> { "#EXTM3U", "#EXT-X-VERSION:3" };

        foreach (var variant in profile.Variants) {
            var bandwidth = TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000 + audioBitrateBps;
            var attributes = new List<string> {
                $"BANDWIDTH={bandwidth}",
                $"RESOLUTION={variant.Resolution.Replace(':', 'x')}"
            };

            // RFC 8216 says CODECS SHOULD be present. Without it a player has to download and
            // demux a segment to work out what to tell MSE, which is where "unsupported audio
            // config" errors come from. Omitted rather than guessed if the probe fails.
            var codecs = await ProbeCodecsAsync(
                Path.Combine(outputDir, MediaNames.HlsPlaylist(variant.Label)),
                cancellationToken);
            if (codecs != null) {
                attributes.Add($"CODECS=\"{codecs}\"");
            }

            lines.Add($"#EXT-X-STREAM-INF:{string.Join(",", attributes)}");
            lines.Add(MediaNames.HlsPlaylist(variant.Label));
        }

        await File.WriteAllLinesAsync(masterPath, lines, cancellationToken);
        _logger.LogInformation("Generated master playlist at {Path}", masterPath);
    }

    private static readonly Dictionary<string, int> H264ProfileIds = new(StringComparer.OrdinalIgnoreCase) {
        ["Constrained Baseline"] = 0x42,
        ["Baseline"] = 0x42,
        ["Main"] = 0x4D,
        ["High"] = 0x64,
        ["High 10"] = 0x6E
    };

    /// <summary>
    /// Builds the RFC 6381 codec string for a generated rung, e.g. "avc1.640028,mp4a.40.2".
    /// Read back off the encoded output rather than inferred, so it always matches reality.
    /// </summary>
    private async Task<string?> ProbeCodecsAsync(string playlistPath, CancellationToken cancellationToken) {
        if (!File.Exists(playlistPath)) {
            return null;
        }

        try {
            var run = await _runner.RunAsync(
                "ffprobe",
                $"-v quiet -print_format json -show_streams \"{playlistPath}\"",
                timeout: TimeSpan.FromMinutes(1),
                cancellationToken: cancellationToken);

            if (!run.Success || string.IsNullOrWhiteSpace(run.StdOut)) {
                return null;
            }

            using var doc = JsonDocument.Parse(run.StdOut);
            if (!doc.RootElement.TryGetProperty("streams", out var streams)) {
                return null;
            }

            var codecs = new List<string>();

            foreach (var stream in streams.EnumerateArray()) {
                var type = stream.TryGetProperty("codec_type", out var t) ? t.GetString() : null;
                var name = stream.TryGetProperty("codec_name", out var n) ? n.GetString() : null;
                var profileName = stream.TryGetProperty("profile", out var p) ? p.GetString() : null;

                switch (type) {
                    case "video":
                        var video = BuildAvcCodec(name, profileName, stream);
                        if (video != null) {
                            codecs.Add(video);
                        }

                        break;

                    case "audio" when name == "aac":
                        codecs.Add(profileName switch {
                            "HE-AACv2" => "mp4a.40.29",
                            "HE-AAC" => "mp4a.40.5",
                            _ => "mp4a.40.2"
                        });
                        break;
                }
            }

            return codecs.Count > 0 ? string.Join(",", codecs) : null;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Could not probe codecs for {Path}", playlistPath);
            return null;
        }
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
