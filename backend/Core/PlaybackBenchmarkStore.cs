using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;

namespace WebWVideoStreamingAPI.Core;

public static class BenchmarkSchema {
    /// <summary>Version echoed to the frontend with every benchmark response.</summary>
    public const int Version = 1;

    /// <summary>
    /// How the trace document is stored and returned. One instance, so stored JSON and served JSON
    /// cannot drift apart.
    /// </summary>
    public static readonly JsonSerializerOptions Json = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

// Serialized straight to the wire — property names are the JSON field names.
public sealed class BenchmarkRunDto {
    public required string Id { get; init; }
    public required string Mode { get; init; }
    public required string NetworkProfile { get; init; }
    public required string LadderKind { get; init; }
    public required string Protocol { get; init; }
    public required string AbrAlgorithm { get; init; }
    public required int Repetition { get; init; }
    public double? StartupMs { get; init; }
    public required double BufferingRatio { get; init; }
    public required int RebufferCount { get; init; }
    public required double RebufferMs { get; init; }
    public required int QualitySwitches { get; init; }
    public required int Oscillations { get; init; }
    public required double TimeWeightedBitrateBps { get; init; }
    public required double DroppedFrameRatio { get; init; }
    public double? RecoveryMs { get; init; }
    public required bool Failed { get; init; }
    public string? ErrorMessage { get; init; }
    public required DateTime CreatedAtUtc { get; init; }
}

/// <summary>Mean and spread over the repetitions of one cell — the shape a chapter 5 table row takes.</summary>
public sealed class BenchmarkAggregateDto {
    public required string NetworkProfile { get; init; }
    public required string LadderKind { get; init; }
    public required string Protocol { get; init; }
    public required string AbrAlgorithm { get; init; }
    public required int Runs { get; init; }
    public required double StartupMsMean { get; init; }
    public required double StartupMsStdDev { get; init; }
    public required double BufferingRatioMean { get; init; }
    public required double BufferingRatioStdDev { get; init; }
    public required double QualitySwitchesMean { get; init; }
    public required double OscillationsMean { get; init; }
    public required double TimeWeightedBitrateBpsMean { get; init; }
    public double? RecoveryMsMean { get; init; }
}

public sealed class VideoBenchmarksResponse {
    public required string RouteId { get; init; }
    public int SchemaVersion { get; init; } = BenchmarkSchema.Version;
    public required IReadOnlyList<BenchmarkRunDto> Runs { get; init; }
    public required IReadOnlyList<BenchmarkAggregateDto> Aggregates { get; init; }
}

public sealed class SaveBenchmarkResult {
    public bool Success { get; init; }
    public string? ErrorCode { get; init; }
    public string? Message { get; init; }
    public PlaybackBenchmark? Benchmark { get; init; }
}

/// <summary>
/// Stores playback measurements reported by the client and aggregates them per configuration.
/// </summary>
/// <remarks>
/// Everything here is client-reported, so values are clamped rather than trusted: a browser tab
/// throttled in the background, or one that slept, can report a ratio above one or a negative
/// duration, and a single such row would quietly distort a mean in the thesis.
/// </remarks>
public sealed class PlaybackBenchmarkStore {
    private readonly AppDbContext _dbContext;
    private readonly ILogger<PlaybackBenchmarkStore> _logger;

    public PlaybackBenchmarkStore(AppDbContext dbContext, ILogger<PlaybackBenchmarkStore> logger) {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<SaveBenchmarkResult> SaveAsync(
        string routeId,
        PlaybackBenchmark benchmark,
        CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return new SaveBenchmarkResult {
                Success = false,
                ErrorCode = "NotFound",
                Message = "Video not found"
            };
        }

        benchmark.Id = Guid.NewGuid();
        benchmark.VideoId = video.Id;
        benchmark.CreatedAtUtc = DateTime.UtcNow;
        benchmark.Repetition = Math.Clamp(benchmark.Repetition, 1, 100);
        benchmark.BufferingRatio = Math.Clamp(benchmark.BufferingRatio, 0, 1);
        benchmark.DroppedFrameRatio = Math.Clamp(benchmark.DroppedFrameRatio, 0, 1);
        benchmark.RebufferCount = Math.Max(0, benchmark.RebufferCount);
        benchmark.RebufferMs = Math.Max(0, benchmark.RebufferMs);
        benchmark.QualitySwitches = Math.Max(0, benchmark.QualitySwitches);
        benchmark.Oscillations = Math.Max(0, benchmark.Oscillations);
        benchmark.TimeWeightedBitrateBps = Math.Max(0, benchmark.TimeWeightedBitrateBps);
        benchmark.StartupMs = benchmark.StartupMs is { } startup && startup >= 0 ? startup : null;
        benchmark.RecoveryMs = benchmark.RecoveryMs is { } recovery && recovery >= 0 ? recovery : null;
        benchmark.ErrorMessage = Trim(benchmark.ErrorMessage, 2000);

        _dbContext.PlaybackBenchmarks.Add(benchmark);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Benchmark stored for {RouteId}: {Protocol}/{Algorithm} rep {Repetition} on {Profile}",
            routeId,
            benchmark.Protocol,
            benchmark.AbrAlgorithm,
            benchmark.Repetition,
            benchmark.NetworkProfile);

        return new SaveBenchmarkResult { Success = true, Benchmark = benchmark };
    }

    public async Task<VideoBenchmarksResponse?> ListAsync(
        string routeId,
        CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return null;
        }

        var rows = await _dbContext.PlaybackBenchmarks
            .AsNoTracking()
            .Where(benchmark => benchmark.VideoId == video.Id)
            .OrderBy(benchmark => benchmark.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return new VideoBenchmarksResponse {
            RouteId = routeId,
            Runs = rows.Select(ToDto).ToList(),
            Aggregates = Aggregate(rows)
        };
    }

    /// <summary>
    /// Collapses repetitions of the same cell into a mean and spread. Failed runs are excluded —
    /// a run that never played is not a slow run, and averaging it in would understate the rest.
    /// </summary>
    private static List<BenchmarkAggregateDto> Aggregate(List<PlaybackBenchmark> rows) {
        return rows
            .Where(row => !row.Failed)
            .GroupBy(row => new { row.NetworkProfile, row.LadderKind, row.Protocol, row.AbrAlgorithm })
            .Select(group => {
                var startup = Summarize(group.Select(row => row.StartupMs).OfType<double>().ToList());
                var buffering = Summarize(group.Select(row => row.BufferingRatio).ToList());
                var recovery = group.Select(row => row.RecoveryMs).OfType<double>().ToList();

                return new BenchmarkAggregateDto {
                    NetworkProfile = group.Key.NetworkProfile.ToString(),
                    LadderKind = group.Key.LadderKind,
                    Protocol = group.Key.Protocol,
                    AbrAlgorithm = group.Key.AbrAlgorithm,
                    Runs = group.Count(),
                    StartupMsMean = startup.Mean,
                    StartupMsStdDev = startup.StdDev,
                    BufferingRatioMean = buffering.Mean,
                    BufferingRatioStdDev = buffering.StdDev,
                    QualitySwitchesMean = group.Average(row => (double)row.QualitySwitches),
                    OscillationsMean = group.Average(row => (double)row.Oscillations),
                    TimeWeightedBitrateBpsMean = group.Average(row => row.TimeWeightedBitrateBps),
                    RecoveryMsMean = recovery.Count > 0 ? recovery.Average() : null
                };
            })
            .OrderBy(item => item.NetworkProfile)
            .ThenBy(item => item.Protocol)
            .ThenBy(item => item.AbrAlgorithm)
            .ToList();
    }

    /// <summary>Mean and sample standard deviation, matching the frontend's `summarize`.</summary>
    private static (double Mean, double StdDev) Summarize(List<double> values) {
        if (values.Count == 0) {
            return (0, 0);
        }

        var mean = values.Average();
        if (values.Count < 2) {
            return (mean, 0);
        }

        // n−1: these repetitions are a sample of possible runs, not every run that could exist.
        var variance = values.Sum(value => Math.Pow(value - mean, 2)) / (values.Count - 1);
        return (mean, Math.Sqrt(variance));
    }

    private static BenchmarkRunDto ToDto(PlaybackBenchmark benchmark) => new() {
        Id = benchmark.Id.ToString("N"),
        Mode = benchmark.Mode.ToString(),
        NetworkProfile = benchmark.NetworkProfile.ToString(),
        LadderKind = benchmark.LadderKind,
        Protocol = benchmark.Protocol,
        AbrAlgorithm = benchmark.AbrAlgorithm,
        Repetition = benchmark.Repetition,
        StartupMs = benchmark.StartupMs,
        BufferingRatio = benchmark.BufferingRatio,
        RebufferCount = benchmark.RebufferCount,
        RebufferMs = benchmark.RebufferMs,
        QualitySwitches = benchmark.QualitySwitches,
        Oscillations = benchmark.Oscillations,
        TimeWeightedBitrateBps = benchmark.TimeWeightedBitrateBps,
        DroppedFrameRatio = benchmark.DroppedFrameRatio,
        RecoveryMs = benchmark.RecoveryMs,
        Failed = benchmark.Failed,
        ErrorMessage = benchmark.ErrorMessage,
        CreatedAtUtc = benchmark.CreatedAtUtc
    };

    private static string? Trim(string? value, int maxLength) {
        if (string.IsNullOrWhiteSpace(value)) {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }
}
