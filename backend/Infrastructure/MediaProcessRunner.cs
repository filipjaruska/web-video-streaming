using System.Diagnostics;

namespace WebWVideoStreamingAPI.Infrastructure;

public class MediaProcessRunResult {
    public bool Success { get; set; }
    public int ExitCode { get; set; }
    public string StdOut { get; set; } = string.Empty;
    public string StdErr { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
}

public interface IMediaProcessRunner {
    Task EnsureAvailableAsync(string executable, CancellationToken cancellationToken = default);
    Task<MediaProcessRunResult> RunAsync(
        string executable,
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default);
}

public class MediaProcessRunner : IMediaProcessRunner {
    private readonly ILogger<MediaProcessRunner> _logger;

    public MediaProcessRunner(ILogger<MediaProcessRunner> logger) {
        _logger = logger;
    }

    public async Task EnsureAvailableAsync(string executable, CancellationToken cancellationToken = default) {
        try {
            var result = await RunAsync(executable, "-version", timeout: TimeSpan.FromSeconds(10), cancellationToken: cancellationToken);
            if (!result.Success) {
                throw new InvalidOperationException($"{executable} is not available");
            }
        } catch (Exception ex) when (ex is not InvalidOperationException) {
            throw new InvalidOperationException($"{executable} not found or not working: {ex.Message}", ex);
        }
    }

    public async Task<MediaProcessRunResult> RunAsync(
        string executable,
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default) {
        var result = new MediaProcessRunResult();

        var processInfo = new ProcessStartInfo {
            FileName = executable,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (!string.IsNullOrEmpty(workingDirectory)) {
            processInfo.WorkingDirectory = workingDirectory;
        }

        _logger.LogInformation("Starting {Executable}: {Executable} {Args}", executable, executable, arguments);

        using var process = Process.Start(processInfo);
        if (process == null) {
            result.Success = false;
            result.ErrorMessage = $"Failed to start {executable} process";
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
                    throw new TimeoutException($"{executable} timed out after {timeout.Value.TotalMinutes:0.##} minutes");
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
            result.ErrorMessage = $"{executable} failed (exit code {process.ExitCode}): {result.StdErr}";
            _logger.LogError("{Executable} error (exit code {ExitCode}): {Error}", executable, process.ExitCode, result.StdErr);
        } else {
            _logger.LogInformation("{Executable} completed successfully", executable);
        }

        return result;
    }
}

public static class LavfiPathHelper {
    /// <summary>
    /// Escape a file path for use inside a lavfi movie= filter argument.
    /// </summary>
    public static string EscapeForMovieFilter(string path) {
        var normalized = Path.GetFullPath(path).Replace('\\', '/');
        return normalized
            .Replace("\\", "\\\\")
            .Replace("'", "'\\''")
            .Replace(":", "\\:");
    }
}
