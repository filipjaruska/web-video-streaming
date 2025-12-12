using System.Diagnostics;

namespace WebWVideoStreamingAPI.Services;

public interface IVideoTranscodingService {
    Task<TranscodeResult> GenerateHlsAsync(string inputPath, string outputDir, CancellationToken cancellationToken = default);
    Task<TranscodeResult> GenerateDashAsync(string inputPath, string outputDir, CancellationToken cancellationToken = default);
}

public class TranscodeResult {
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public List<string> GeneratedFiles { get; set; } = new();
}

public class VideoTranscodingService : IVideoTranscodingService {
    private readonly ILogger<VideoTranscodingService> _logger;

    private readonly (string resolution, string bitrate, string label)[] _variants = new[] {
        ("1920:1080", "5000k", "1080p"),
        ("640:360", "800k", "360p")
    };

    public VideoTranscodingService(ILogger<VideoTranscodingService> logger) {
        _logger = logger;
    }

    public async Task<TranscodeResult> GenerateHlsAsync(string inputPath, string outputDir, CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            var tasks = _variants.Select(variant =>
                GenerateHlsVariantAsync(inputPath, outputDir, variant.resolution, variant.bitrate, variant.label, cancellationToken)
            ).ToList();

            var variantResults = await Task.WhenAll(tasks);

            var failures = variantResults.Where(r => !r.Success).ToList();
            if (failures.Any()) {
                result.Success = false;
                result.ErrorMessage = string.Join("; ", failures.Select(f => f.ErrorMessage));
                return result;
            }

            await GenerateHlsMasterPlaylistAsync(outputDir, _variants);
            result.GeneratedFiles.Add("master.m3u8");

            _logger.LogInformation("Successfully generated HLS streams in {OutputDir}", outputDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate HLS for {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    public async Task<TranscodeResult> GenerateDashAsync(string inputPath, string outputDir, CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            // DASH requires all variants in ONE FFmpeg command to create unified MPD manifest
            var manifestPath = "manifest.mpd";

            var ffmpegArgs = new System.Text.StringBuilder();
            // -y: overwrite output files without asking
            // -i: input file path
            ffmpegArgs.Append($@"-y -i ""{inputPath}"" ");

            // -filter_complex: apply complex filtergraph (multiple inputs/outputs)
            // [0:v]: select video stream from input 0
            // scale=1920:1080: resize to specific resolution
            // [v0]: label the output stream as "v0" for later reference
            var filterComplex = new List<string>();
            var mapCommands = new List<string>();

            for (int i = 0; i < _variants.Length; i++) {
                var (resolution, bitrate, label) = _variants[i];
                filterComplex.Add($"[0:v]scale={resolution}[v{i}]");
            }

            ffmpegArgs.Append($@"-filter_complex ""{string.Join(";", filterComplex)}"" ");

            for (int i = 0; i < _variants.Length; i++) {
                var (resolution, bitrate, label) = _variants[i];
                var bitrateNum = int.Parse(bitrate.TrimEnd('k'));

                // -map "[v0]": select the filtered video stream labeled "v0"
                ffmpegArgs.Append($@"-map ""[v{i}]"" ");
                // -c:v:0: codec for video stream 0 (libx264 = H.264 encoder)
                // -b:v:0: target bitrate for video stream 0
                // -maxrate: maximum bitrate (for rate control)
                // -bufsize: rate control buffer size (usually 2x bitrate)
                ffmpegArgs.Append($@"-c:v:{i} libx264 -b:v:{i} {bitrate} -maxrate:{i} {bitrate} -bufsize:{i} {bitrateNum * 2}k ");
                // -map 0:a?: map audio stream from input 0 if it exists (? means optional)
                ffmpegArgs.Append($@"-map 0:a? ");
                // -c:a:0: audio codec (aac)
                // -b:a:0: audio bitrate
                ffmpegArgs.Append($@"-c:a:{i} aac -b:a:{i} 128k ");
            }

            // -f dash: output format = MPEG-DASH
            ffmpegArgs.Append($@"-f dash ");
            // -seg_duration: target segment duration in seconds
            ffmpegArgs.Append($@"-seg_duration 6 ");
            // -use_template 1: use SegmentTemplate instead of SegmentList in MPD (more efficient)
            ffmpegArgs.Append($@"-use_template 1 ");
            // -use_timeline 1: use SegmentTimeline in MPD (allows variable segment durations)
            ffmpegArgs.Append($@"-use_timeline 1 ");
            // -init_seg_name: naming pattern for initialization segments
            // $RepresentationID$: replaced with quality variant ID (0, 1, etc.)
            ffmpegArgs.Append($@"-init_seg_name ""init-$RepresentationID$.m4s"" ");
            // -media_seg_name: naming pattern for media segments
            // $Number%05d$: segment number padded to 5 digits (00001, 00002, etc.)
            ffmpegArgs.Append($@"-media_seg_name ""chunk-$RepresentationID$-$Number%05d$.m4s"" ");
            ffmpegArgs.Append($@"""{manifestPath}""");

            _logger.LogInformation("Starting FFmpeg DASH: ffmpeg {Args}", ffmpegArgs.ToString());

            var processInfo = new ProcessStartInfo {
                FileName = "ffmpeg",
                Arguments = ffmpegArgs.ToString(),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                // WorkingDirectory: FFmpeg uses relative paths for segment files, so set this to output directory
                WorkingDirectory = outputDir
            };

            using var process = Process.Start(processInfo);
            if (process != null) {
                // IMPORTANT: Read output/error streams asynchronously BEFORE WaitForExitAsync
                // to prevent deadlock (buffers can fill up and block FFmpeg)
                var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
                var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

                await process.WaitForExitAsync(cancellationToken);

                var output = await outputTask;
                var error = await errorTask;

                if (process.ExitCode != 0) {
                    _logger.LogError("FFmpeg DASH error (exit code {ExitCode}): {Error}", process.ExitCode, error);
                    result.Success = false;
                    result.ErrorMessage = $"FFmpeg failed: {error}";
                } else {
                    _logger.LogInformation("FFmpeg DASH completed successfully");
                    result.Success = true;
                    result.GeneratedFiles.Add("manifest.mpd");

                    // Count generated segments
                    var segments = Directory.GetFiles(outputDir, "*.m4s");
                    result.GeneratedFiles.AddRange(segments.Select(Path.GetFileName).Where(f => f != null)!);
                }
            } else {
                result.Success = false;
                result.ErrorMessage = "Failed to start FFmpeg process";
            }

            _logger.LogInformation("Successfully generated DASH streams in {OutputDir}", outputDir);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate DASH for {InputPath}", inputPath);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    private async Task<TranscodeResult> GenerateHlsVariantAsync(
        string inputPath,
        string outputDir,
        string scale,
        string bitrate,
        string name,
        CancellationToken cancellationToken) {
        var result = new TranscodeResult();
        var segmentPattern = Path.Combine(outputDir, $"{name}_%03d.ts");
        var playlistPath = Path.Combine(outputDir, $"{name}.m3u8");

        // -y: overwrite without asking
        // -vf scale: simple video filter (not filter_complex since only one output)
        // -c:v: video codec, -b:v: video bitrate
        // -c:a: audio codec, -b:a: audio bitrate, -ac: audio channels
        // -f hls: output format = HTTP Live Streaming (Apple's protocol)
        // -hls_time: target segment duration in seconds
        // -hls_list_size 0: keep all segments in playlist (0 = unlimited)
        // -hls_segment_filename: pattern for .ts segment files
        // -y: overwrite without asking
        // -vf scale: simple video filter (not filter_complex since only one output)
        // -c:v: video codec, -b:v: video bitrate
        // -c:a: audio codec, -b:a: audio bitrate, -ac: audio channels
        // -f hls: output format = HTTP Live Streaming (Apple's protocol)
        // -hls_time: target segment duration in seconds
        // -hls_list_size 0: keep all segments in playlist (0 = unlimited)
        // -hls_segment_filename: pattern for .ts segment files
        var ffmpegArgs = $@"-y -i ""{inputPath}"" " +
            $@"-vf scale={scale} " +
            $@"-c:v libx264 -b:v {bitrate} -maxrate {bitrate} -bufsize {int.Parse(bitrate.TrimEnd('k')) * 2}k " +
            $@"-c:a aac -b:a 128k -ac 2 " +
            $@"-f hls " +
            $@"-hls_time 6 " +
            $@"-hls_list_size 0 " +
            $@"-hls_segment_filename ""{segmentPattern}"" " +
            $@"""{playlistPath}""";

        _logger.LogInformation("Starting FFmpeg for {Name}: ffmpeg {Args}", name, ffmpegArgs);

        try {
            var processInfo = new ProcessStartInfo {
                FileName = "ffmpeg",
                Arguments = ffmpegArgs,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(processInfo);
            if (process != null) {
                // Read streams async first to prevent buffer deadlock
                var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
                var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

                await process.WaitForExitAsync(cancellationToken);

                var output = await outputTask;
                var error = await errorTask;

                if (process.ExitCode != 0) {
                    _logger.LogError("FFmpeg error for {Name} (exit code {ExitCode}): {Error}", name, process.ExitCode, error);
                    result.Success = false;
                    result.ErrorMessage = $"FFmpeg failed for {name}: {error}";
                } else {
                    _logger.LogInformation("FFmpeg completed successfully for {Name}", name);
                    result.Success = true;
                    result.GeneratedFiles.Add($"{name}.m3u8");
                }
            } else {
                result.Success = false;
                result.ErrorMessage = "Failed to start FFmpeg process";
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Exception while generating HLS variant {Name}", name);
            result.Success = false;
            result.ErrorMessage = ex.Message;
        }

        return result;
    }

    private async Task GenerateHlsMasterPlaylistAsync(string outputDir, (string scale, string bitrate, string name)[] variants) {
        var masterPlaylistPath = Path.Combine(outputDir, "master.m3u8");

        var lines = new List<string> { "#EXTM3U", "#EXT-X-VERSION:3" };

        foreach (var variant in variants) {
            var bitrate = int.Parse(variant.bitrate.TrimEnd('k')) * 1000;
            var resolution = variant.scale.Replace(":", "x");

            lines.Add($"#EXT-X-STREAM-INF:BANDWIDTH={bitrate},RESOLUTION={resolution}");
            lines.Add($"{variant.name}.m3u8");
        }

        await File.WriteAllLinesAsync(masterPlaylistPath, lines);
        _logger.LogInformation("Generated master playlist at {Path}", masterPlaylistPath);
    }
}
