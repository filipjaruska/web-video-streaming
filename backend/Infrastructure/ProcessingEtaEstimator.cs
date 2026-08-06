using System.Globalization;
using System.Text.RegularExpressions;

namespace WebWVideoStreamingAPI.Infrastructure;

/// <summary>
/// Estimates remaining processing time from milestone weights + encode-grid
/// sub-progress, optionally calibrated by elapsed wall time.
/// </summary>
public static class ProcessingEtaEstimator {
    // Relative cost weights for unfinished work (arbitrary units; not seconds).
    // Encode grid dominates wall clock for typical clips.
    private static readonly Phase[] Phases = [
        new(8, 10, 2),   // Starting → media info
        new(10, 12, 3),  // Subtitles
        new(12, 14, 8),  // Source SI/TI
        new(14, 16, 2),  // Thumbnail
        new(16, 22, 18), // Static HLS
        new(22, 28, 18), // Static DASH
        new(28, 32, 10), // Transcode SI/TI
        new(32, 40, 14), // Static VMAF
        new(40, 45, 2),  // Enter encode grid
        new(45, 76, 80), // Encode grid (CRF × resolution)
        new(76, 78, 4),  // Derive ladder
        new(78, 82, 14), // Dynamic HLS
        new(82, 86, 14), // Dynamic DASH
        new(86, 90, 8),  // Dynamic SI/TI
        new(90, 95, 12), // Dynamic VMAF
        new(95, 100, 2)  // Finish
    ];

    private const double DefaultSecondsPerWeight = 4.5;
    private const int MinProgressForEta = 8;
    private const int MinProgressForCalibration = 20;
    private const int MinElapsedSecondsForCalibration = 30;
    private static readonly Regex EncodeGridFraction = new(
        @"Encode grid\s*\((\d+)\s*/\s*(\d+)\)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static int? EstimateRemainingSeconds(
        int progressPercent,
        string? currentStep,
        DateTime? processingStartedAtUtc,
        DateTime utcNow,
        int? encodeGridDone = null,
        int? encodeGridTotal = null) {
        if (progressPercent < MinProgressForEta || progressPercent >= 100) {
            return null;
        }

        ParseEncodeGridFraction(currentStep, ref encodeGridDone, ref encodeGridTotal);

        var remainingWeight = RemainingWeight(
            progressPercent,
            encodeGridDone,
            encodeGridTotal);
        if (remainingWeight <= 0) {
            return null;
        }

        var secondsPerWeight = DefaultSecondsPerWeight;
        if (processingStartedAtUtc.HasValue) {
            var elapsed = (utcNow - processingStartedAtUtc.Value).TotalSeconds;
            if (elapsed >= MinElapsedSecondsForCalibration &&
                progressPercent >= MinProgressForCalibration) {
                var completedWeight = CompletedWeight(
                    progressPercent,
                    encodeGridDone,
                    encodeGridTotal);
                if (completedWeight > 0.5) {
                    var scale = elapsed / completedWeight;
                    // Clamp so a slow start / fast probe doesn't explode or collapse ETA.
                    scale = Math.Clamp(scale, 0.35 * DefaultSecondsPerWeight, 3.0 * DefaultSecondsPerWeight);
                    secondsPerWeight = scale;
                }
            }
        }

        var seconds = (int)Math.Ceiling(remainingWeight * secondsPerWeight);
        return Math.Clamp(seconds, 5, 24 * 60 * 60);
    }

    private static void ParseEncodeGridFraction(
        string? currentStep,
        ref int? done,
        ref int? total) {
        if (done.HasValue && total.HasValue) {
            return;
        }

        if (string.IsNullOrWhiteSpace(currentStep)) {
            return;
        }

        var match = EncodeGridFraction.Match(currentStep);
        if (!match.Success) {
            return;
        }

        if (int.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var d) &&
            int.TryParse(match.Groups[2].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var t) &&
            t > 0) {
            done ??= d;
            total ??= t;
        }
    }

    private static double RemainingWeight(
        int progressPercent,
        int? encodeGridDone,
        int? encodeGridTotal) {
        double remaining = 0;

        foreach (var phase in Phases) {
            if (progressPercent >= phase.EndPercent) {
                continue;
            }

            if (progressPercent <= phase.StartPercent) {
                remaining += phase.Weight;
                continue;
            }

            // Partially through this phase.
            if (phase.StartPercent == 45 && phase.EndPercent == 76 &&
                encodeGridDone.HasValue && encodeGridTotal is > 0) {
                var fractionLeft = 1.0 - Math.Clamp(
                    (double)encodeGridDone.Value / encodeGridTotal.Value,
                    0,
                    1);
                remaining += phase.Weight * fractionLeft;
            } else {
                var span = phase.EndPercent - phase.StartPercent;
                var through = progressPercent - phase.StartPercent;
                var fractionLeft = span <= 0 ? 0 : 1.0 - Math.Clamp((double)through / span, 0, 1);
                remaining += phase.Weight * fractionLeft;
            }
        }

        return remaining;
    }

    private static double CompletedWeight(
        int progressPercent,
        int? encodeGridDone,
        int? encodeGridTotal) {
        double completed = 0;

        foreach (var phase in Phases) {
            if (progressPercent >= phase.EndPercent) {
                completed += phase.Weight;
                continue;
            }

            if (progressPercent <= phase.StartPercent) {
                break;
            }

            if (phase.StartPercent == 45 && phase.EndPercent == 76 &&
                encodeGridDone.HasValue && encodeGridTotal is > 0) {
                var fractionDone = Math.Clamp(
                    (double)encodeGridDone.Value / encodeGridTotal.Value,
                    0,
                    1);
                completed += phase.Weight * fractionDone;
            } else {
                var span = phase.EndPercent - phase.StartPercent;
                var through = progressPercent - phase.StartPercent;
                var fractionDone = span <= 0 ? 1 : Math.Clamp((double)through / span, 0, 1);
                completed += phase.Weight * fractionDone;
            }

            break;
        }

        return completed;
    }

    private readonly record struct Phase(int StartPercent, int EndPercent, double Weight);
}
