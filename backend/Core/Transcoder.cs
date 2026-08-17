using System.Globalization;
using System.Text;

namespace WebWVideoStreamingAPI.Core;

public sealed record TranscodeVariant(string Resolution, string Bitrate, string Label);

public sealed class TranscodeProfile {
    public string Name { get; init; } = "default";
    public IReadOnlyList<TranscodeVariant> Variants { get; init; } = Array.Empty<TranscodeVariant>();
    public string VideoCodec { get; init; } = "libx264";
    public string AudioCodec { get; init; } = "aac";
    public string AudioBitrate { get; init; } = "128k";
    public int SegmentDurationSeconds { get; init; } = 6;

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

            await WriteHlsMasterPlaylistAsync(outputDir, profile);
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
                args.Append($@"-c:v:{i} {profile.VideoCodec} -b:v:{i} {variant.Bitrate} -maxrate:{i} {variant.Bitrate} -bufsize:{i} {bitrateKbps * 2}k ");
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
                $@"-y -ss {seek} -i ""{inputPath}"" -frames:v 1 -vf ""scale='min(720,iw)':-2"" -c:v libwebp -quality 75 ""{outputPath}""";

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

    /// <summary>Encodes a single MP4 at a resolution + CRF for encode-grid RD sampling (not HLS/DASH).</summary>
    public async Task<TranscodeResult> EncodeCrfAsync(
        string inputPath,
        string outputPath,
        string resolution,
        int crf,
        string preset = "medium",
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            RequireInput(inputPath);
            EnsureParentDir(outputPath);
            await _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);

            // Video-only CRF sample — audio omitted to speed encode-grid sweeps.
            var args =
                $@"-y -i ""{inputPath}"" " +
                $@"-vf scale={resolution} " +
                $@"-c:v libx264 -crf {crf} -preset {preset} -pix_fmt yuv420p " +
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
            $@"-c:v {profile.VideoCodec} -b:v {variant.Bitrate} -maxrate {variant.Bitrate} -bufsize {bitrateKbps * 2}k " +
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

    private async Task WriteHlsMasterPlaylistAsync(string outputDir, TranscodeProfile profile) {
        var masterPath = Path.Combine(outputDir, MediaNames.HlsMaster);
        var audioBitrateBps = TranscodeProfile.ParseBitrateKbps(profile.AudioBitrate) * 1000;

        var lines = new List<string> { "#EXTM3U", "#EXT-X-VERSION:3" };

        foreach (var variant in profile.Variants) {
            var bandwidth = TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000 + audioBitrateBps;
            lines.Add($"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={variant.Resolution.Replace(':', 'x')}");
            lines.Add(MediaNames.HlsPlaylist(variant.Label));
        }

        await File.WriteAllLinesAsync(masterPath, lines);
        _logger.LogInformation("Generated master playlist at {Path}", masterPath);
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
