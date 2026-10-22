using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;

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

        try {
            await RecoverAsync(stoppingToken);
        } catch (Exception ex) when (ex is not OperationCanceledException) {
            _logger.LogError(ex, "Could not recover processing jobs from before the restart");
        }

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

    /// <summary>
    /// Puts back what a restart dropped. The queue lives in memory, so a restart forgets every job
    /// in it: videos still waiting are queued again, in upload order, and a run cut off midway is
    /// marked failed — its partial outputs are nothing to resume from, and the video can be uploaded
    /// again.
    /// </summary>
    private async Task RecoverAsync(CancellationToken cancellationToken) {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        const string interrupted = "Interrupted by a server restart";

        var sessions = await db.UploadSessions
            .Where(session => session.Status == UploadSessionStatus.Queued || session.Status == UploadSessionStatus.Processing)
            .OrderBy(session => session.UploadedAtUtc)
            .ToListAsync(cancellationToken);

        foreach (var session in sessions) {
            if (session.Status == UploadSessionStatus.Queued) {
                _queue.Enqueue(session.VideoId);
                continue;
            }

            session.Status = UploadSessionStatus.Failed;
            session.CurrentStep = interrupted;
            session.EstimatedRemainingSeconds = null;
            session.CompletedAtUtc = now;
            session.UpdatedAtUtc = now;
        }

        var transcodes = await db.Transcodes
            .Where(transcode => transcode.Status == TranscodeStatus.Running)
            .ToListAsync(cancellationToken);

        foreach (var transcode in transcodes) {
            transcode.Status = TranscodeStatus.Failed;
            transcode.ErrorMessage = interrupted;
            transcode.CompletedAtUtc = now;
        }

        await db.SaveChangesAsync(cancellationToken);

        var requeued = sessions.Count(session => session.Status == UploadSessionStatus.Queued);
        if (requeued > 0 || sessions.Count > requeued || transcodes.Count > 0) {
            _logger.LogInformation(
                "Recovered after restart: {Requeued} queued video(s) requeued, {Failed} interrupted run(s) marked failed",
                requeued,
                sessions.Count - requeued);
        }
    }
}
