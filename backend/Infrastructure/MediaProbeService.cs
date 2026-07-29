using System.Text.Json;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed class MediaProbeResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }
    public JsonDocument? ProbeData { get; init; }
}

public interface IMediaProbeService {
    Task<MediaProbeResult> ProbeAsync(string sourcePath, CancellationToken cancellationToken = default);
}

public class MediaProbeService : IMediaProbeService {
    private readonly IMediaProcessRunner _runner;
    private readonly ILogger<MediaProbeService> _logger;

    public MediaProbeService(IMediaProcessRunner runner, ILogger<MediaProbeService> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<MediaProbeResult> ProbeAsync(string sourcePath, CancellationToken cancellationToken = default) {
        var args = $"-v quiet -print_format json -show_format -show_streams -show_chapters \"{sourcePath}\"";

        try {
            var result = await _runner.RunAsync(
                "ffprobe",
                args,
                timeout: TimeSpan.FromMinutes(5),
                cancellationToken: cancellationToken);

            if (!result.Success) {
                return new MediaProbeResult {
                    Success = false,
                    ErrorMessage = result.ErrorMessage ?? "ffprobe failed"
                };
            }

            if (string.IsNullOrWhiteSpace(result.StdOut)) {
                return new MediaProbeResult {
                    Success = false,
                    ErrorMessage = "ffprobe returned empty output"
                };
            }

            var doc = JsonDocument.Parse(result.StdOut);
            return new MediaProbeResult {
                Success = true,
                ProbeData = doc
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Media probe failed for {SourcePath}", sourcePath);
            return new MediaProbeResult {
                Success = false,
                ErrorMessage = ex.Message
            };
        }
    }
}
