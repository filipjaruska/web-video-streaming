using System.Threading.Channels;
using WebWVideoStreamingAPI.Core;

namespace WebWVideoStreamingAPI.Infrastructure;

public sealed record VideoProcessingJob(Guid VideoId);

public interface IVideoProcessingQueue {
    void Enqueue(Guid videoId);
    IAsyncEnumerable<VideoProcessingJob> ReadAllAsync(CancellationToken cancellationToken);
}

/// <summary>
/// In-process Channel queue for post-upload video processing.
/// </summary>
public sealed class VideoProcessingQueue : IVideoProcessingQueue {
    private readonly Channel<VideoProcessingJob> _channel =
        Channel.CreateUnbounded<VideoProcessingJob>(new UnboundedChannelOptions {
            SingleReader = true,
            SingleWriter = false
        });

    public void Enqueue(Guid videoId) {
        _channel.Writer.TryWrite(new VideoProcessingJob(videoId));
    }

    public IAsyncEnumerable<VideoProcessingJob> ReadAllAsync(CancellationToken cancellationToken) {
        return _channel.Reader.ReadAllAsync(cancellationToken);
    }
}

/// <summary>
/// Hosted worker that drains the in-process processing queue one job at a time.
/// </summary>
public sealed class VideoProcessingWorker : BackgroundService {
    private readonly IVideoProcessingQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<VideoProcessingWorker> _logger;

    public VideoProcessingWorker(
        IVideoProcessingQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<VideoProcessingWorker> logger) {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        _logger.LogInformation("Video processing worker started");

        await foreach (var job in _queue.ReadAllAsync(stoppingToken)) {
            try {
                using var scope = _scopeFactory.CreateScope();
                var pipeline = scope.ServiceProvider.GetRequiredService<VideoProcessingPipeline>();
                var result = await pipeline.RunAsync(job.VideoId, stoppingToken);

                if (!result.Success) {
                    _logger.LogWarning(
                        "Video processing failed for {VideoId}: {Error}",
                        job.VideoId,
                        result.ErrorMessage);
                } else {
                    _logger.LogInformation(
                        "Video processing succeeded for {VideoId} (transcode {TranscodeId})",
                        job.VideoId,
                        result.TranscodeId);
                }
            } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
                break;
            } catch (Exception ex) {
                _logger.LogError(ex, "Video processing crashed for {VideoId}", job.VideoId);
            }
        }

        _logger.LogInformation("Video processing worker stopped");
    }
}
