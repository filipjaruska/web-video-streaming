using System.Globalization;
using System.Text.Json;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// The one place ffprobe JSON is read and media numbers are turned into display strings.
/// ffprobe is inconsistent about whether numeric fields arrive as numbers or as strings, so every
/// accessor here tolerates both.
/// </summary>
public static class MediaFormatting {
    public static string? GetString(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        return value.ValueKind switch {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "Yes",
            JsonValueKind.False => "No",
            _ => null
        };
    }

    public static int? GetInt(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) {
            return number;
        }

        return value.ValueKind == JsonValueKind.String &&
               int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    public static long? GetLong(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)) {
            return number;
        }

        return value.ValueKind == JsonValueKind.String &&
               long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    public static double? GetDouble(JsonElement element, string property) {
        if (!element.TryGetProperty(property, out var value)) {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) {
            return number;
        }

        var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    /// <summary>Reads a value out of the element's `tags` object, falling back to a case-insensitive scan.</summary>
    public static string? GetTag(JsonElement element, string key) {
        if (!element.TryGetProperty("tags", out var tags) || tags.ValueKind != JsonValueKind.Object) {
            return null;
        }

        if (tags.TryGetProperty(key, out var value)) {
            return value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
        }

        // ffprobe is inconsistent about tag casing (TITLE vs title, LANGUAGE vs language).
        foreach (var property in tags.EnumerateObject()) {
            if (string.Equals(property.Name, key, StringComparison.OrdinalIgnoreCase)) {
                return property.Value.ValueKind == JsonValueKind.String
                    ? property.Value.GetString()
                    : property.Value.GetRawText();
            }
        }

        return null;
    }

    /// <summary>Reads a double out of a JSON element that may be a number or a numeric string.</summary>
    public static bool TryReadDouble(JsonElement element, out double value) {
        value = 0;
        return element.ValueKind switch {
            JsonValueKind.Number => element.TryGetDouble(out value),
            JsonValueKind.String => double.TryParse(
                element.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out value),
            _ => false
        };
    }

    /// <summary>Finds the first video stream's dimensions in an ffprobe document.</summary>
    public static bool TryGetVideoResolution(JsonDocument probeData, out int width, out int height) {
        width = 0;
        height = 0;
        if (!probeData.RootElement.TryGetProperty("streams", out var streams)) {
            return false;
        }

        foreach (var stream in streams.EnumerateArray()) {
            if (GetString(stream, "codec_type") != "video") {
                continue;
            }

            if (stream.TryGetProperty("width", out var w) &&
                stream.TryGetProperty("height", out var h) &&
                w.TryGetInt32(out width) &&
                h.TryGetInt32(out height) &&
                width > 0 &&
                height > 0) {
                return true;
            }
        }

        return false;
    }

    /// <summary>Parses a profile resolution such as "1920:1080" or "1920x1080".</summary>
    public static (int Width, int Height)? ParseResolution(string resolution) {
        var parts = resolution.Split(':', 'x', 'X');
        if (parts.Length == 2 &&
            int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var width) &&
            int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var height)) {
            return (width, height);
        }

        return null;
    }

    public static string FormatBitrate(long bitsPerSecond) {
        if (bitsPerSecond >= 1_000_000) {
            return $"{bitsPerSecond / 1_000_000.0:0.##} Mb/s";
        }

        return $"{bitsPerSecond / 1000.0:0.##} kb/s";
    }

    public static string? FormatBitrate(long? bitsPerSecond) =>
        bitsPerSecond is > 0 ? FormatBitrate(bitsPerSecond.Value) : null;

    public static string FormatDuration(double seconds) {
        var total = TimeSpan.FromSeconds(seconds);
        if (total.TotalHours >= 1) {
            return $"{(int)total.TotalHours} h {total.Minutes} min {total.Seconds} s";
        }

        if (total.TotalMinutes >= 1) {
            return $"{(int)total.TotalMinutes} min {total.Seconds} s";
        }

        return $"{seconds:0.###} s";
    }

    public static string? FormatDuration(double? seconds) =>
        seconds is > 0 ? FormatDuration(seconds.Value) : null;

    public static string? FormatFileSize(long? bytes) {
        if (bytes is not > 0) {
            return null;
        }

        const double kib = 1024;
        var value = (double)bytes.Value;

        if (value >= kib * kib * kib) {
            return $"{value / (kib * kib * kib):0.##} GiB";
        }

        if (value >= kib * kib) {
            return $"{value / (kib * kib):0.##} MiB";
        }

        if (value >= kib) {
            return $"{value / kib:0.##} KiB";
        }

        return $"{bytes} bytes";
    }

    public static string? FormatSampleRate(int? sampleRate) {
        if (sampleRate is not > 0) {
            return null;
        }

        return sampleRate >= 1000
            ? $"{sampleRate.Value / 1000.0:0.##} kHz"
            : $"{sampleRate} Hz";
    }

    /// <summary>Creates a uniquely named scratch directory under the system temp root.</summary>
    public static string NewTempDir(string prefix) {
        var path = Path.Combine(Path.GetTempPath(), $"{prefix}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    public static void TryDeleteDirectory(string path, ILogger logger) {
        try {
            if (Directory.Exists(path)) {
                Directory.Delete(path, recursive: true);
            }
        } catch (Exception ex) {
            logger.LogWarning(ex, "Failed to delete temp directory {Path}", path);
        }
    }
}
