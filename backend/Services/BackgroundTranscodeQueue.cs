namespace WebWVideoStreamingAPI.Services;

/// <summary>
/// Queues post-upload transcode work on a background thread with a fresh DI scope.
/// </summary>
public interface IBackgroundTranscodeQueue {
    void Enqueue(Guid videoId);
}

public class BackgroundTranscodeQueue : IBackgroundTranscodeQueue {
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<BackgroundTranscodeQueue> _logger;

    public BackgroundTranscodeQueue(IServiceScopeFactory scopeFactory, ILogger<BackgroundTranscodeQueue> logger) {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public void Enqueue(Guid videoId) {
        _ = Task.Run(async () => {
            try {
                using var scope = _scopeFactory.CreateScope();
                var jobService = scope.ServiceProvider.GetRequiredService<IVideoTranscodeJobService>();
                var result = await jobService.TranscodeAsync(videoId);
                if (!result.Success) {
                    _logger.LogWarning(
                        "Background transcode failed for video {VideoId}: {Error}",
                        videoId,
                        result.ErrorMessage);
                } else {
                    _logger.LogInformation(
                        "Background transcode succeeded for video {VideoId} (transcode {TranscodeId})",
                        videoId,
                        result.TranscodeId);
                }
            } catch (Exception ex) {
                _logger.LogError(ex, "Background transcode crashed for video {VideoId}", videoId);
            }
        });
    }
}
