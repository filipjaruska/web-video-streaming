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

    public VideoTranscodingService(ILogger<VideoTranscodingService> logger) {
        _logger = logger;
    }

    public async Task<TranscodeResult> GenerateHlsAsync(string inputPath, string outputDir, CancellationToken cancellationToken = default) {
        var result = new TranscodeResult { Success = true };

        try {
            var variants = new[]
            {
                ("1920:1080", "5000k", "1080p"),
                ("640:360", "800k", "360p")
            };

            var tasks = variants.Select(variant =>
                GenerateHlsVariantAsync(inputPath, outputDir, variant.Item1, variant.Item2, variant.Item3, cancellationToken)
            ).ToList();

            var variantResults = await Task.WhenAll(tasks);

            var failures = variantResults.Where(r => !r.Success).ToList();
            if (failures.Any()) {
                result.Success = false;
                result.ErrorMessage = string.Join("; ", failures.Select(f => f.ErrorMessage));
                return result;
            }

            await GenerateHlsMasterPlaylistAsync(outputDir, variants);
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
        // TODO: Implement DASH generation
        // Similar structure to HLS but using DASH manifest format (MPD)
        await Task.CompletedTask;
        return new TranscodeResult {
            Success = false,
            ErrorMessage = "DASH generation not yet implemented"
        };
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
