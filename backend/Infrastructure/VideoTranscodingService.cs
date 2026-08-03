namespace WebWVideoStreamingAPI.Infrastructure;

public record TranscodeVariant(string Resolution, string Bitrate, string Label);

public class TranscodeProfile {
    public string Name { get; init; } = "default";
    public IReadOnlyList<TranscodeVariant> Variants { get; init; } = Array.Empty<TranscodeVariant>();
    public string VideoCodec { get; init; } = "libx264";
    public string AudioCodec { get; init; } = "aac";
    public string AudioBitrate { get; init; } = "128k";
    public int SegmentDurationSeconds { get; init; } = 6;

    public static TranscodeProfile Default { get; } = new() {
        Name = "default",
        Variants = new[] {
            new TranscodeVariant("1920:1080", "4500k", "1080p"),
            new TranscodeVariant("1280:720", "2500k", "720p"),
            new TranscodeVariant("854:480", "1200k", "480p"),
            new TranscodeVariant("640:360", "800k", "360p"),
            new TranscodeVariant("426:240", "400k", "240p")
        }
    };

    public static int ParseBitrateKbps(string bitrate) =>
        int.Parse(bitrate.TrimEnd('k', 'K'));
}

public class TranscodeResult {
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public List<string> GeneratedFiles { get; set; } = new();
}

public interface IVideoTranscodingService {
    Task<TranscodeResult> GenerateHlsAsync(
        string inputPath,
        string outputDir,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default);

    Task<TranscodeResult> GenerateDashAsync(
        string inputPath,
        string outputDir,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default);

    Task<TranscodeResult> ExtractThumbnailAsync(
        string inputPath,
        string outputPath,
        double atSeconds = 1,
        CancellationToken cancellationToken = default);
}

public class VideoTranscodingService : IVideoTranscodingService {
    private readonly ILogger<VideoTranscodingService> _logger;
    private readonly IFfmpegRunner _ffmpeg;

    public VideoTranscodingService(ILogger<VideoTranscodingService> logger, IFfmpegRunner ffmpeg) {
        _logger = logger;
        _ffmpeg = ffmpeg;
    }

    public async Task<TranscodeResult> GenerateHlsAsync(
        string inputPath,
        string outputDir,
        TranscodeProfile? profile = null,
        CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };
        profile ??= TranscodeProfile.Default;

        try {
            if (!File.Exists(inputPath)) {
                throw new FileNotFoundException($"Input video not found: {inputPath}");
            }

            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            _logger.LogInformation("Starting HLS generation for {InputPath} with profile {Profile}", inputPath, profile.Name);

            var tasks = profile.Variants.Select(variant =>
                GenerateHlsVariantAsync(inputPath, outputDir, variant, profile, cancellationToken)
            ).ToList();

            var variantResults = await Task.WhenAll(tasks);

            var failures = variantResults.Where(r => !r.Success).ToList();
            if (failures.Any()) {
                result.Success = false;
                result.ErrorMessage = string.Join("; ", failures.Select(f => f.ErrorMessage));
                return result;
            }

            await GenerateHlsMasterPlaylistAsync(outputDir, profile.Variants, profile);
            result.GeneratedFiles.Add("master.m3u8");

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
            if (!File.Exists(inputPath)) {
                throw new FileNotFoundException($"Input video not found: {inputPath}");
            }

            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            var manifestPath = "manifest.mpd";
            var ffmpegArgs = new System.Text.StringBuilder();
            ffmpegArgs.Append($@"-y -i ""{inputPath}"" ");

            var filterComplex = new List<string>();
            for (int i = 0; i < profile.Variants.Count; i++) {
                filterComplex.Add($"[0:v]scale={profile.Variants[i].Resolution}[v{i}]");
            }

            ffmpegArgs.Append($@"-filter_complex ""{string.Join(";", filterComplex)}"" ");

            for (int i = 0; i < profile.Variants.Count; i++) {
                var variant = profile.Variants[i];
                var bitrateNum = TranscodeProfile.ParseBitrateKbps(variant.Bitrate);

                ffmpegArgs.Append($@"-map ""[v{i}]"" ");
                ffmpegArgs.Append($@"-c:v:{i} {profile.VideoCodec} -b:v:{i} {variant.Bitrate} -maxrate:{i} {variant.Bitrate} -bufsize:{i} {bitrateNum * 2}k ");
                ffmpegArgs.Append($@"-map 0:a? ");
                ffmpegArgs.Append($@"-c:a:{i} {profile.AudioCodec} -b:a:{i} {profile.AudioBitrate} ");
            }

            ffmpegArgs.Append($@"-f dash ");
            ffmpegArgs.Append($@"-seg_duration {profile.SegmentDurationSeconds} ");
            ffmpegArgs.Append($@"-use_template 1 ");
            ffmpegArgs.Append($@"-use_timeline 1 ");
            ffmpegArgs.Append($@"-init_seg_name ""init-$RepresentationID$.m4s"" ");
            ffmpegArgs.Append($@"-media_seg_name ""chunk-$RepresentationID$-$Number%05d$.m4s"" ");
            ffmpegArgs.Append($@"""{manifestPath}""");

            _logger.LogInformation("Starting DASH generation for {InputPath} with profile {Profile}", inputPath, profile.Name);

            var runResult = await _ffmpeg.RunAsync(
                ffmpegArgs.ToString(),
                workingDirectory: outputDir,
                cancellationToken: cancellationToken);

            if (!runResult.Success) {
                result.Success = false;
                result.ErrorMessage = runResult.ErrorMessage ?? $"FFmpeg failed: {runResult.StdErr}";
                return result;
            }

            result.GeneratedFiles.Add("manifest.mpd");
            var segments = Directory.GetFiles(outputDir, "*.m4s");
            result.GeneratedFiles.AddRange(segments.Select(Path.GetFileName).Where(f => f != null)!);

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
            if (!File.Exists(inputPath)) {
                throw new FileNotFoundException($"Input video not found: {inputPath}");
            }

            await _ffmpeg.EnsureAvailableAsync(cancellationToken);

            var outputDir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(outputDir)) {
                Directory.CreateDirectory(outputDir);
            }

            var seek = atSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
            // Scale down for list/cards and encode WebP (~tens of KB vs ~1MB near-lossless JPEG).
            var ffmpegArgs =
                $@"-y -ss {seek} -i ""{inputPath}"" -frames:v 1 -vf ""scale='min(720,iw)':-2"" -c:v libwebp -quality 75 ""{outputPath}""";

            _logger.LogInformation("Extracting thumbnail from {InputPath} at {AtSeconds}s to {OutputPath}", inputPath, atSeconds, outputPath);

            var runResult = await _ffmpeg.RunAsync(
                ffmpegArgs,
                timeout: TimeSpan.FromMinutes(1),
                cancellationToken: cancellationToken);

            if (!runResult.Success) {
                result.Success = false;
                result.ErrorMessage = runResult.ErrorMessage ?? $"FFmpeg failed: {runResult.StdErr}";
                return result;
            }

            result.GeneratedFiles.Add(Path.GetFileName(outputPath));
            _logger.LogInformation("Successfully extracted thumbnail to {OutputPath}", outputPath);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to extract thumbnail from {InputPath}", inputPath);
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
        var segmentPattern = Path.Combine(outputDir, $"{variant.Label}_%03d.ts");
        var playlistPath = Path.Combine(outputDir, $"{variant.Label}.m3u8");
        var bitrateNum = TranscodeProfile.ParseBitrateKbps(variant.Bitrate);

        var ffmpegArgs = $@"-y -i ""{inputPath}"" " +
            $@"-vf scale={variant.Resolution} " +
            $@"-c:v {profile.VideoCodec} -b:v {variant.Bitrate} -maxrate {variant.Bitrate} -bufsize {bitrateNum * 2}k " +
            $@"-c:a {profile.AudioCodec} -b:a {profile.AudioBitrate} -ac 2 " +
            $@"-f hls " +
            $@"-hls_time {profile.SegmentDurationSeconds} " +
            $@"-hls_list_size 0 " +
            $@"-hls_segment_filename ""{segmentPattern}"" " +
            $@"""{playlistPath}""";

        try {
            var runResult = await _ffmpeg.RunAsync(
                ffmpegArgs,
                timeout: TimeSpan.FromMinutes(5),
                cancellationToken: cancellationToken);

            if (!runResult.Success) {
                result.Success = false;
                result.ErrorMessage = $"FFmpeg failed for {variant.Label}: {runResult.StdErr}";
            } else {
                result.Success = true;
                result.GeneratedFiles.Add($"{variant.Label}.m3u8");
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Exception while generating HLS variant {Name}", variant.Label);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    private async Task GenerateHlsMasterPlaylistAsync(
        string outputDir,
        IReadOnlyList<TranscodeVariant> variants,
        TranscodeProfile profile) {
        var masterPlaylistPath = Path.Combine(outputDir, "master.m3u8");
        var audioBitrateBps = TranscodeProfile.ParseBitrateKbps(profile.AudioBitrate) * 1000;

        var lines = new List<string> { "#EXTM3U", "#EXT-X-VERSION:3" };

        foreach (var variant in variants) {
            var bandwidth = TranscodeProfile.ParseBitrateKbps(variant.Bitrate) * 1000 + audioBitrateBps;
            var resolution = variant.Resolution.Replace(":", "x");

            lines.Add($"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={resolution}");
            lines.Add($"{variant.Label}.m3u8");
        }

        await File.WriteAllLinesAsync(masterPlaylistPath, lines);
        _logger.LogInformation("Generated master playlist at {Path}", masterPlaylistPath);
    }
}
