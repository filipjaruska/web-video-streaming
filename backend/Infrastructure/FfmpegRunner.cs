using System.Diagnostics;

namespace WebWVideoStreamingAPI.Infrastructure;

public class FfmpegRunResult {
    public bool Success { get; set; }
    public int ExitCode { get; set; }
    public string StdOut { get; set; } = string.Empty;
    public string StdErr { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
}

public interface IFfmpegRunner {
    Task EnsureAvailableAsync(CancellationToken cancellationToken = default);
    Task<FfmpegRunResult> RunAsync(
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default);
}

public class FfmpegRunner : IFfmpegRunner {
    private readonly ILogger<FfmpegRunner> _logger;

    public FfmpegRunner(ILogger<FfmpegRunner> logger) {
        _logger = logger;
    }

    public async Task EnsureAvailableAsync(CancellationToken cancellationToken = default) {
        try {
            var result = await RunAsync("-version", timeout: TimeSpan.FromSeconds(10), cancellationToken: cancellationToken);
            if (!result.Success) {
                throw new InvalidOperationException("FFmpeg is not available");
            }
        } catch (Exception ex) when (ex is not InvalidOperationException) {
            throw new InvalidOperationException($"FFmpeg not found or not working: {ex.Message}", ex);
        }
    }

    public async Task<FfmpegRunResult> RunAsync(
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default) {
        var result = new FfmpegRunResult();

        var processInfo = new ProcessStartInfo {
            FileName = "ffmpeg",
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (!string.IsNullOrEmpty(workingDirectory)) {
            processInfo.WorkingDirectory = workingDirectory;
        }

        _logger.LogInformation("Starting FFmpeg: ffmpeg {Args}", arguments);

        using var process = Process.Start(processInfo);
        if (process == null) {
            result.Success = false;
            result.ErrorMessage = "Failed to start FFmpeg process";
            return result;
        }

        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        try {
            if (timeout.HasValue) {
                using var timeoutCts = new CancellationTokenSource(timeout.Value);
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

                try {
                    await process.WaitForExitAsync(linkedCts.Token);
                } catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested) {
                    process.Kill(true);
                    await process.WaitForExitAsync(CancellationToken.None);
                    throw new TimeoutException($"FFmpeg timed out after {timeout.Value.TotalMinutes:0.##} minutes");
                }
            } else {
                await process.WaitForExitAsync(cancellationToken);
            }
        } catch (OperationCanceledException) {
            if (!process.HasExited) {
                process.Kill(true);
                await process.WaitForExitAsync(CancellationToken.None);
            }
            throw;
        }

        result.StdOut = await outputTask;
        result.StdErr = await errorTask;
        result.ExitCode = process.ExitCode;
        result.Success = process.ExitCode == 0;

        if (!result.Success) {
            result.ErrorMessage = $"FFmpeg failed (exit code {process.ExitCode}): {result.StdErr}";
            _logger.LogError("FFmpeg error (exit code {ExitCode}): {Error}", process.ExitCode, result.StdErr);
        } else {
            _logger.LogInformation("FFmpeg completed successfully");
        }

        return result;
    }
}
