using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace WebWVideoStreamingAPI.Core;

/// <summary>
/// The tags the frontend caches its server-rendered data under (<c>frontend/lib/cacheTags.ts</c>).
/// </summary>
public static class FrontendCacheTags {
    public const string Videos = "videos";
    public const string Analysis = "analysis";
    public const string Benchmarks = "benchmarks";

    public static readonly string[] All = [Videos, Analysis, Benchmarks];
}

/// <summary>
/// Tells the frontend which of its caches a database write made stale, by calling its
/// <c>/api/revalidate</c> route. The frontend caches until told, so this is what keeps its pages
/// current.
/// </summary>
/// <remarks>
/// Writes come in bursts (one pipeline step saves several times), so tags are collected for a moment
/// and sent as one call. A call that fails, because the frontend is redeploying for one, is retried
/// for a couple of minutes; after that the frontend's own fallback lifetime catches up. The target
/// is <c>FRONTEND_URL</c>, else the first allowed CORS origin; <c>REVALIDATE_SECRET</c>, when set,
/// travels as a bearer token and must match the frontend's.
/// </remarks>
public sealed class FrontendCacheNotifier : BackgroundService {
    public const string UrlKey = "FRONTEND_URL";
    public const string SecretKey = "REVALIDATE_SECRET";

    private static readonly TimeSpan Batch = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(15);
    private const int MaxAttempts = 8;

    private readonly Channel<string> _tags = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions { SingleReader = true });
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly Uri? _endpoint;
    private readonly string? _secret;
    private readonly ILogger<FrontendCacheNotifier> _logger;
    private bool _failing;

    public FrontendCacheNotifier(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<FrontendCacheNotifier> logger) {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _secret = configuration[SecretKey]?.Trim() is { Length: > 0 } secret ? secret : null;

        var frontend = configuration[UrlKey]?.Trim() is { Length: > 0 } url
            ? url
            : configuration.GetSection("AllowedOrigins").Get<string[]>()?.FirstOrDefault() ?? "http://localhost:3000";
        if (Uri.TryCreate(frontend.TrimEnd('/') + "/api/revalidate", UriKind.Absolute, out var endpoint)) {
            _endpoint = endpoint;
        } else {
            _logger.LogWarning("Frontend cache invalidation is off: {Url} is not a URL", frontend);
        }
    }

    /// <summary>Queues the tags; never blocks and never throws, whatever the frontend is doing.</summary>
    public void Invalidate(IEnumerable<string> tags) {
        foreach (var tag in tags) {
            _tags.Writer.TryWrite(tag);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        if (_endpoint == null) {
            return;
        }

        // A start can follow a recreated database, which leaves nothing the frontend cached true.
        Invalidate(FrontendCacheTags.All);
        _logger.LogInformation("Frontend caches are invalidated through {Endpoint}", _endpoint);

        var pending = new HashSet<string>();
        try {
            while (await _tags.Reader.WaitToReadAsync(stoppingToken)) {
                await Task.Delay(Batch, stoppingToken);
                for (var attempt = 1; ; attempt++) {
                    while (_tags.Reader.TryRead(out var tag)) {
                        pending.Add(tag);
                    }
                    if (await SendAsync(pending, stoppingToken) || attempt == MaxAttempts) {
                        break;
                    }
                    await Task.Delay(RetryDelay, stoppingToken);
                }
                pending.Clear();
            }
        } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
            // Shutting down.
        }
    }

    private async Task<bool> SendAsync(IReadOnlyCollection<string> tags, CancellationToken cancellationToken) {
        try {
            using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint) {
                Content = JsonContent.Create(new { tags })
            };
            if (_secret != null) {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _secret);
            }

            var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            using var response = await client.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();

            if (_failing) {
                _failing = false;
                _logger.LogInformation("Frontend cache invalidation reaches {Endpoint} again", _endpoint);
            }
            return true;
        } catch (Exception ex) when (ex is HttpRequestException
                                     || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested)) {
            // Logged once per outage: a frontend that is not running locally would otherwise flood the log.
            if (!_failing) {
                _failing = true;
                _logger.LogWarning("Could not invalidate the frontend caches ({Tags}) at {Endpoint}: {Message}",
                    string.Join(", ", tags), _endpoint, ex.Message);
            }
            return false;
        }
    }
}

/// <summary>
/// Turns every successful save into the frontend cache tags it touched, so no write path has to
/// remember to report itself.
/// </summary>
/// <remarks>
/// Upload sessions only count when their status changes: that is the only part of them the
/// catalogue shows, and progress is saved every few seconds while a video processes. The one bulk
/// delete (analysis reports, in <see cref="WebWVideoStreamingAPI.Analysis.AnalysisStore"/>) runs
/// with the deletion of their video, which already invalidates everything.
/// </remarks>
public sealed class FrontendCacheInterceptor : SaveChangesInterceptor {
    private readonly FrontendCacheNotifier _notifier;
    private readonly ConditionalWeakTable<DbContext, string[]> _pending = new();

    public FrontendCacheInterceptor(FrontendCacheNotifier notifier) {
        _notifier = notifier;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result) {
        Collect(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default) {
        Collect(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result) {
        Flush(eventData.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData,
        int result,
        CancellationToken cancellationToken = default) {
        Flush(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData) {
        if (eventData.Context != null) {
            _pending.Remove(eventData.Context);
        }
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default) {
        SaveChangesFailed(eventData);
        return Task.CompletedTask;
    }

    // Read before the save: afterwards every entry is Unchanged.
    private void Collect(DbContext? context) {
        if (context == null) {
            return;
        }
        var tags = context.ChangeTracker.Entries()
            .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .SelectMany(TagsFor)
            .Distinct()
            .ToArray();
        if (tags.Length > 0) {
            _pending.AddOrUpdate(context, tags);
        }
    }

    private void Flush(DbContext? context) {
        if (context != null && _pending.TryGetValue(context, out var tags)) {
            _pending.Remove(context);
            _notifier.Invalidate(tags);
        }
    }

    private static string[] TagsFor(EntityEntry entry) => entry.Entity switch {
        Video when entry.State == EntityState.Deleted => FrontendCacheTags.All,
        Video => [FrontendCacheTags.Videos],
        UploadSession when entry.State != EntityState.Modified
            || entry.Property(nameof(UploadSession.Status)).IsModified => [FrontendCacheTags.Videos],
        Transcode => [FrontendCacheTags.Videos, FrontendCacheTags.Analysis],
        AnalysisReport => [FrontendCacheTags.Analysis],
        PlaybackBenchmark => [FrontendCacheTags.Benchmarks],
        _ => []
    };
}
