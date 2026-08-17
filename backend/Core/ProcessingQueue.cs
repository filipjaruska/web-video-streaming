using System.Threading.Channels;

namespace WebWVideoStreamingAPI.Core;

public sealed record VideoProcessingJob(Guid VideoId);

/// <summary>In-process queue of post-upload processing jobs.</summary>
public sealed class ProcessingQueue {
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
/// Drains the processing queue one job at a time. Single-reader by design — the pipeline saturates
/// the CPU with ffmpeg, so running jobs concurrently would only make each one slower.
/// </summary>
public sealed class ProcessingWorker : BackgroundService {
    private readonly ProcessingQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProcessingWorker> _logger;

    public ProcessingWorker(
        ProcessingQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<ProcessingWorker> logger) {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        _logger.LogInformation("Video processing worker started");

        await foreach (var job in _queue.ReadAllAsync(stoppingToken)) {
            try {
                using var scope = _scopeFactory.CreateScope();
                var pipeline = scope.ServiceProvider.GetRequiredService<ProcessingPipeline>();
                var result = await pipeline.RunAsync(job.VideoId, stoppingToken);

                if (result.Success) {
                    _logger.LogInformation(
                        "Video processing succeeded for {VideoId} (transcode {TranscodeId})",
                        job.VideoId,
                        result.TranscodeId);
                } else {
                    _logger.LogWarning(
                        "Video processing failed for {VideoId}: {Error}",
                        job.VideoId,
                        result.ErrorMessage);
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
