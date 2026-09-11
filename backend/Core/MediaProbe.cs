using System.Globalization;
using System.Text.Json;

namespace WebWVideoStreamingAPI.Core;

public sealed class MediaProbeResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }

    /// <summary>Owned by the caller — dispose it once the probe data has been read.</summary>
    public JsonDocument? ProbeData { get; init; }
}

/// <summary>One packet of a video stream, as ffprobe reports it (presentation order is not guaranteed).</summary>
public sealed record VideoPacket(double PtsTime, double DurationTime, long Size, bool Key);

/// <summary>What a video stream actually costs, measured from its packets.</summary>
public sealed class VideoRateStats {
    public int PacketCount { get; init; }
    public long TotalBytes { get; init; }
    public double DurationSec { get; init; }
    public long AverageBps { get; init; }

    /// <summary>
    /// The highest per-segment bitrate, with segments cut where the packagers cut them. This is the
    /// figure a manifest's peak bandwidth must declare for an ABR rule to size a rung safely.
    /// </summary>
    public long PeakSegmentBps { get; init; }

    public IReadOnlyList<double> SegmentDurations { get; init; } = [];
    public int KeyframeCount { get; init; }
}

public static class VideoRate {
    /// <summary>A trailing segment shorter than this is left out of the peak — a sub-second tail that
    /// is mostly one IDR frame would otherwise report a peak no playback ever sustains.</summary>
    private const double MinSegmentForPeakSec = 3.0;

    /// <summary>
    /// Bitrate from the sum of the stream's packet sizes over its presentation span.
    /// </summary>
    /// <remarks>
    /// Deliberately not the container's <c>bit_rate</c>: that includes every track and the box
    /// overhead. The first full run measured HLS renditions — which muxed the 128k audio track —
    /// at 139–156 kb/s above the same content in DASH, and compared them against a grid encoded
    /// without audio, so predicted and packaged points sat on different bases.
    /// </remarks>
    public static VideoRateStats? Compute(IReadOnlyList<VideoPacket> packets, double segmentSeconds = 6) {
        if (packets.Count == 0) {
            return null;
        }

        var start = packets.Min(packet => packet.PtsTime);
        var end = packets.Max(packet => packet.PtsTime + Math.Max(packet.DurationTime, 0));
        var duration = end - start;
        if (duration <= 0) {
            return null;
        }

        var totalBytes = packets.Sum(packet => packet.Size);
        var keys = packets
            .Where(packet => packet.Key)
            .Select(packet => packet.PtsTime - start)
            .OrderBy(time => time)
            .ToList();

        // The packagers cut at the first keyframe at or after each multiple of the target
        // duration, so a scene-cut keyframe just before a boundary never starts a segment.
        var boundaries = new List<double> { 0 };
        for (var n = 1; n * segmentSeconds < duration; n++) {
            var target = n * segmentSeconds;
            var cut = keys.FirstOrDefault(time => time >= target - 1e-6, double.NaN);
            if (double.IsNaN(cut) || cut >= duration) {
                break;
            }

            if (cut > boundaries[^1] + 1e-9) {
                boundaries.Add(cut);
            }
        }

        var durations = new List<double>();
        long peak = 0;

        for (var i = 0; i < boundaries.Count; i++) {
            var segmentStart = boundaries[i];
            var segmentEnd = i + 1 < boundaries.Count ? boundaries[i + 1] : duration;
            var segmentDuration = segmentEnd - segmentStart;
            durations.Add(segmentDuration);

            var isShortTail = i == boundaries.Count - 1 && boundaries.Count > 1 && segmentDuration < MinSegmentForPeakSec;
            if (segmentDuration <= 0 || isShortTail) {
                continue;
            }

            var bytes = packets
                .Where(packet => packet.PtsTime - start >= segmentStart - 1e-9 && packet.PtsTime - start < segmentEnd - 1e-9)
                .Sum(packet => packet.Size);

            peak = Math.Max(peak, (long)Math.Round(bytes * 8 / segmentDuration));
        }

        return new VideoRateStats {
            PacketCount = packets.Count,
            TotalBytes = totalBytes,
            DurationSec = duration,
            AverageBps = (long)Math.Round(totalBytes * 8 / duration),
            PeakSegmentBps = peak,
            SegmentDurations = durations,
            KeyframeCount = keys.Count
        };
    }
}

public sealed class MediaProbe {
    private readonly ProcessRunner _runner;
    private readonly ILogger<MediaProbe> _logger;

    public MediaProbe(ProcessRunner runner, ILogger<MediaProbe> logger) {
        _runner = runner;
        _logger = logger;
    }

    public async Task<MediaProbeResult> ProbeAsync(string sourcePath, CancellationToken cancellationToken = default) {
        var args = $"-v quiet -print_format json -show_format -show_streams -show_chapters \"{sourcePath}\"";

        try {
            var result = await _runner.RunAsync(
                "ffprobe",
                args,
                timeout: TimeSpan.FromMinutes(5),
                cancellationToken: cancellationToken);

            if (!result.Success) {
                return Fail(result.ErrorMessage ?? "ffprobe failed");
            }

            if (string.IsNullOrWhiteSpace(result.StdOut)) {
                return Fail("ffprobe returned empty output");
            }

            return new MediaProbeResult {
                Success = true,
                ProbeData = JsonDocument.Parse(result.StdOut)
            };
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Media probe failed for {SourcePath}", sourcePath);
            return Fail(ex.Message);
        }
    }

    /// <summary>Every packet of the first video stream, or null when the file cannot be read.</summary>
    public Task<IReadOnlyList<VideoPacket>?> ProbeVideoPacketsAsync(
        string path,
        CancellationToken cancellationToken = default) =>
        ProbePacketsAsync(path, "v:0", cancellationToken);

    /// <summary>Every packet of one stream (an ffprobe selector such as <c>v:0</c> or <c>a:0</c>), or null.</summary>
    public async Task<IReadOnlyList<VideoPacket>?> ProbePacketsAsync(
        string path,
        string streamSelector,
        CancellationToken cancellationToken = default) {
        var args = $"-v error -select_streams {streamSelector} -show_entries packet=pts_time,duration_time,size,flags -of json \"{path}\"";

        try {
            var result = await _runner.RunAsync(
                "ffprobe",
                args,
                timeout: TimeSpan.FromMinutes(5),
                cancellationToken: cancellationToken);

            if (!result.Success || string.IsNullOrWhiteSpace(result.StdOut)) {
                return null;
            }

            using var document = JsonDocument.Parse(result.StdOut);
            if (!document.RootElement.TryGetProperty("packets", out var packets)) {
                return null;
            }

            var list = new List<VideoPacket>();
            foreach (var packet in packets.EnumerateArray()) {
                if (ReadDouble(packet, "pts_time") is not { } pts) {
                    continue;
                }

                var flags = packet.TryGetProperty("flags", out var flagValue) ? flagValue.GetString() ?? "" : "";
                list.Add(new VideoPacket(
                    pts,
                    ReadDouble(packet, "duration_time") ?? 0,
                    (long)(ReadDouble(packet, "size") ?? 0),
                    flags.StartsWith('K')));
            }

            return list;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Packet probe failed for {Path}", path);
            return null;
        }
    }

    /// <summary>ffprobe writes most numeric fields as JSON strings; accept either form.</summary>
    private static double? ReadDouble(JsonElement element, string name) {
        if (!element.TryGetProperty(name, out var value)) {
            return null;
        }

        return value.ValueKind switch {
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.String when double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private static MediaProbeResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
