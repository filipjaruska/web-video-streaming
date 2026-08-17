using System.Text.Json;

namespace WebWVideoStreamingAPI.Core;

public sealed class MediaProbeResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }

    /// <summary>Owned by the caller — dispose it once the probe data has been read.</summary>
    public JsonDocument? ProbeData { get; init; }
}

public sealed class MediaProbe {
    private readonly ProcessRunner _runner;
    private readonly ILogger<MediaProbe> _logger;

    public MediaProbe(ProcessRunner runner, ILogger<MediaProbe> logger) {
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
                return Fail(result.ErrorMessage ?? "ffprobe failed");
            }

            if (string.IsNullOrWhiteSpace(result.StdOut)) {
                return Fail("ffprobe returned empty output");
            }

            return new MediaProbeResult {
                Success = true,
                ProbeData = JsonDocument.Parse(result.StdOut)
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Media probe failed for {SourcePath}", sourcePath);
            return Fail(ex.Message);
        }
    }

    private static MediaProbeResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
