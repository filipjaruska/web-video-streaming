using static WebWVideoStreamingAPI.Analysis.MediaFormatting;

namespace WebWVideoStreamingAPI.Analysis;

public sealed record ComplexityWindow(double StartSec, double EndSec) {
    public double DurationSec => EndSec - StartSec;
}

public sealed class RepresentativeClipResult {
    /// <summary>Path the encode grid should encode from and score against.</summary>
    public required string Path { get; init; }

    /// <summary>False when the whole source is used, i.e. the clip was too short to excerpt.</summary>
    public bool Windowed { get; init; }

    public IReadOnlyList<ComplexityWindow> Windows { get; init; } = [];

    public double DurationSec { get; init; }
}

/// <summary>
/// Picks the busiest stretches of a clip from its SI/TI series and cuts them into one short
/// excerpt, which the encode grid then uses in place of the full source.
/// </summary>
/// <remarks>
/// Two things motivate this. Encoding 45 grid samples over a whole clip is what makes the grid
/// dominate the pipeline's wall clock, and a mean VMAF over the whole clip is dominated by its
/// easy stretches — flat, static shots score near 100 at any sane bitrate and drown out the
/// scenes that actually decide whether a rung is watchable. Scoring the hard parts is a cheap
/// approximation of the shot-aware bit allocation full per-shot encoding would give.
/// </remarks>
public sealed class ComplexityWindows {
    /// <summary>Below this, excerpting saves little and risks a sample too short to encode sanely.</summary>
    private const double MinDurationForWindowingSec = 60;

    private const double WindowSec = 2.0;
    private const double TargetFraction = 0.10;
    private const double MinTargetSec = 20;
    private const double MaxTargetSec = 30;

    private readonly Transcoder _transcoder;
    private readonly MediaProbe _probe;
    private readonly ILogger<ComplexityWindows> _logger;

    public ComplexityWindows(Transcoder transcoder, MediaProbe probe, ILogger<ComplexityWindows> logger) {
        _transcoder = transcoder;
        _probe = probe;
        _logger = logger;
    }

    /// <summary>
    /// Returns the excerpt to run the grid on, falling back to the untouched source whenever the
    /// clip is short, the SI/TI series is missing, or the extraction fails.
    /// </summary>
    public async Task<RepresentativeClipResult> BuildAsync(
        string sourcePath,
        SitiSeriesData? siti,
        string tempDir,
        CancellationToken cancellationToken = default) {
        var duration = await ResolveDurationAsync(sourcePath, siti, cancellationToken);
        var whole = new RepresentativeClipResult { Path = sourcePath, Windowed = false, DurationSec = duration };

        if (duration < MinDurationForWindowingSec) {
            _logger.LogInformation(
                "Encode grid runs on the whole {Duration:0.#}s source — too short to excerpt", duration);
            return whole;
        }

        var windows = SelectWindows(siti, duration);
        if (windows.Count == 0) {
            _logger.LogInformation("No SI/TI series available; encode grid runs on the whole source");
            return whole;
        }

        var excerptPath = Path.Combine(tempDir, "representative.mp4");
        var extract = await _transcoder.ExtractWindowsAsync(
            sourcePath,
            excerptPath,
            windows.Select(window => (window.StartSec, window.EndSec)).ToList(),
            cancellationToken);

        if (!extract.Success || !File.Exists(excerptPath)) {
            _logger.LogWarning(
                "Representative clip extraction failed ({Error}); falling back to the whole source",
                extract.ErrorMessage);
            return whole;
        }

        var excerptDuration = windows.Sum(window => window.DurationSec);
        _logger.LogInformation(
            "Encode grid runs on a {Excerpt:0.#}s excerpt of {Source:0.#}s ({Count} windows)",
            excerptDuration,
            duration,
            windows.Count);

        return new RepresentativeClipResult {
            Path = excerptPath,
            Windowed = true,
            Windows = windows,
            DurationSec = excerptDuration
        };
    }

    /// <summary>
    /// Ranks fixed-length windows by combined spatial and temporal activity, then takes the best
    /// one out of each equal slice of the clip.
    /// </summary>
    /// <remarks>
    /// The stratification matters: picking the globally top-N windows would happily take all of
    /// them from a single action sequence and leave the excerpt unrepresentative of the title.
    /// </remarks>
    internal static List<ComplexityWindow> SelectWindows(SitiSeriesData? siti, double durationSec) {
        if (siti == null || siti.Si.Count == 0 || durationSec <= 0) {
            return [];
        }

        var targetSec = Math.Clamp(durationSec * TargetFraction, MinTargetSec, MaxTargetSec);
        var count = Math.Max(1, (int)Math.Round(targetSec / WindowSec));
        var frameTimes = ResolveFrameTimes(siti, durationSec);

        // SI and TI live on different scales, so each is min-max normalized over the clip before
        // they are summed — otherwise whichever has the wider range decides every window alone.
        var si = Normalize(siti.Si);
        var ti = Normalize(siti.Ti);

        var sliceSec = durationSec / count;
        var windows = new List<ComplexityWindow>();

        for (var slice = 0; slice < count; slice++) {
            var sliceStart = slice * sliceSec;
            var sliceEnd = Math.Min(durationSec, sliceStart + sliceSec);
            if (sliceEnd - sliceStart < WindowSec) {
                continue;
            }

            var best = double.NegativeInfinity;
            var bestStart = sliceStart;

            for (var start = sliceStart; start + WindowSec <= sliceEnd; start += WindowSec / 2) {
                var score = ScoreWindow(frameTimes, si, ti, start, start + WindowSec);
                if (score > best) {
                    best = score;
                    bestStart = start;
                }
            }

            windows.Add(new ComplexityWindow(bestStart, Math.Min(durationSec, bestStart + WindowSec)));
        }

        return Merge(windows);
    }

    private static double ScoreWindow(
        IReadOnlyList<double> frameTimes,
        IReadOnlyList<double> si,
        IReadOnlyList<double> ti,
        double startSec,
        double endSec) {
        double sum = 0;
        var count = 0;

        for (var i = 0; i < frameTimes.Count; i++) {
            if (frameTimes[i] < startSec) {
                continue;
            }

            if (frameTimes[i] >= endSec) {
                break;
            }

            sum += si[Math.Min(i, si.Count - 1)] + ti[Math.Min(i, ti.Count - 1)];
            count++;
        }

        return count == 0 ? double.NegativeInfinity : sum / count;
    }

    /// <summary>Joins windows that touch or overlap, so the excerpt has no one-frame islands.</summary>
    private static List<ComplexityWindow> Merge(List<ComplexityWindow> windows) {
        var merged = new List<ComplexityWindow>();

        foreach (var window in windows.OrderBy(item => item.StartSec)) {
            if (merged.Count > 0 && window.StartSec <= merged[^1].EndSec + 0.001) {
                merged[^1] = merged[^1] with { EndSec = Math.Max(merged[^1].EndSec, window.EndSec) };
                continue;
            }

            merged.Add(window);
        }

        return merged;
    }

    private static List<double> Normalize(IReadOnlyList<double> values) {
        if (values.Count == 0) {
            return [];
        }

        var min = values.Min();
        var max = values.Max();
        var range = max - min;

        return range <= 1e-9
            ? [.. values.Select(_ => 0.0)]
            : [.. values.Select(value => (value - min) / range)];
    }

    /// <summary>
    /// Timestamps for each SI/TI sample, spread evenly across the clip when the siti filter did not
    /// report them.
    /// </summary>
    private static List<double> ResolveFrameTimes(SitiSeriesData siti, double durationSec) {
        if (siti.TimeSec is { Count: > 0 } times && times.Count >= siti.Si.Count) {
            return times;
        }

        var step = durationSec / Math.Max(1, siti.Si.Count);
        return [.. Enumerable.Range(0, siti.Si.Count).Select(index => index * step)];
    }

    private async Task<double> ResolveDurationAsync(
        string sourcePath,
        SitiSeriesData? siti,
        CancellationToken cancellationToken) {
        var probe = await _probe.ProbeAsync(sourcePath, cancellationToken);
        if (probe.Success && probe.ProbeData != null) {
            using (probe.ProbeData) {
                if (probe.ProbeData.RootElement.TryGetProperty("format", out var format)) {
                    var duration = GetDouble(format, "duration") ?? 0;
                    if (duration > 0) {
                        return duration;
                    }
                }
            }
        }

        return siti?.TimeSec is { Count: > 0 } times ? times[^1] : 0;
    }
}
