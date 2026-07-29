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
    private readonly IMediaProcessRunner _runner;

    public FfmpegRunner(IMediaProcessRunner runner) {
        _runner = runner;
    }

    public Task EnsureAvailableAsync(CancellationToken cancellationToken = default) {
        return _runner.EnsureAvailableAsync("ffmpeg", cancellationToken);
    }

    public async Task<FfmpegRunResult> RunAsync(
        string arguments,
        string? workingDirectory = null,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default) {
        var result = await _runner.RunAsync("ffmpeg", arguments, workingDirectory, timeout, cancellationToken);
        return new FfmpegRunResult {
            Success = result.Success,
            ExitCode = result.ExitCode,
            StdOut = result.StdOut,
            StdErr = result.StdErr,
            ErrorMessage = result.ErrorMessage
        };
    }
}
