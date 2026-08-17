namespace WebWVideoStreamingAPI.Core;

/// <summary>Every point the pipeline reports progress from.</summary>
public enum PipelineStep {
    Starting,
    MediaInfo,
    Subtitles,
    SourceSiti,
    Thumbnail,
    StaticHls,
    StaticDash,
    StaticSiti,
    StaticVmaf,
    EncodeGrid,
    DeriveLadder,
    DynamicHls,
    DynamicDash,
    DynamicSiti,
    DynamicVmaf
}

/// <summary>
/// The single table of pipeline progress. It owns both the percentage and label each step reports,
/// and the relative cost weights used to turn a percentage into a time estimate — previously these
/// lived in two files and had to be kept in sync by hand.
/// </summary>
public static class ProcessingEta {
    /// <summary>Percent range the encode grid's sub-progress is mapped across.</summary>
    public const int GridStartPercent = 45;
    public const int GridEndPercent = 76;

    private static readonly Dictionary<PipelineStep, (int Percent, string Label)> Steps = new() {
        [PipelineStep.Starting] = (8, "Preparing source"),
        [PipelineStep.MediaInfo] = (10, "Reading media info"),
        [PipelineStep.Subtitles] = (12, "Extracting subtitles"),
        [PipelineStep.SourceSiti] = (14, "SI/TI analysis"),
        [PipelineStep.Thumbnail] = (16, "Generating thumbnail"),
        [PipelineStep.StaticHls] = (22, "HLS transcoding"),
        [PipelineStep.StaticDash] = (28, "DASH transcoding"),
        [PipelineStep.StaticSiti] = (32, "Analyzing transcodes (SI/TI)"),
        [PipelineStep.StaticVmaf] = (40, "VMAF analysis"),
        [PipelineStep.EncodeGrid] = (GridStartPercent, "Encode grid (CRF × resolution)"),
        [PipelineStep.DeriveLadder] = (78, "Deriving VMAF crossover ladder"),
        [PipelineStep.DynamicHls] = (82, "Dynamic HLS packaging"),
        [PipelineStep.DynamicDash] = (86, "Dynamic DASH packaging"),
        [PipelineStep.DynamicSiti] = (90, "Analyzing dynamic ladder (SI/TI)"),
        [PipelineStep.DynamicVmaf] = (95, "Dynamic ladder VMAF")
    };

    // Relative cost of the work spanning each percentage band (arbitrary units, not seconds).
    // The encode grid dominates wall clock for typical clips.
    private static readonly Band[] Bands = [
        new(8, 10, 2),
        new(10, 12, 3),
        new(12, 14, 8),
        new(14, 16, 2),
        new(16, 22, 18),
        new(22, 28, 18),
        new(28, 32, 10),
        new(32, 40, 14),
        new(40, 45, 2),
        new(GridStartPercent, GridEndPercent, 80),
        new(76, 78, 4),
        new(78, 82, 14),
        new(82, 86, 14),
        new(86, 90, 8),
        new(90, 95, 12),
        new(95, 100, 2)
    ];

    private const double DefaultSecondsPerWeight = 4.5;
    private const int MinProgressForEta = 8;
    private const int MinProgressForCalibration = 20;
    private const int MinElapsedSecondsForCalibration = 30;

    public static int PercentFor(PipelineStep step) => Steps[step].Percent;

    public static string LabelFor(PipelineStep step) => Steps[step].Label;

    /// <summary>Maps encode-grid completion onto the percentage band reserved for it.</summary>
    public static int GridPercent(int done, int total) {
        if (total <= 0) {
            return GridStartPercent;
        }

        var span = GridEndPercent - GridStartPercent;
        var percent = GridStartPercent + (int)Math.Round((double)span * done / total);
        return Math.Clamp(percent, GridStartPercent, GridEndPercent);
    }

    public static string GridLabel(int done, int total) => $"Encode grid ({done}/{total})";

    public static int? EstimateRemainingSeconds(
        int progressPercent,
        DateTime? processingStartedAtUtc,
        DateTime utcNow,
        int? encodeGridDone = null,
        int? encodeGridTotal = null) {
        if (progressPercent < MinProgressForEta || progressPercent >= 100) {
            return null;
        }

        var remainingWeight = RemainingWeight(progressPercent, encodeGridDone, encodeGridTotal);
        if (remainingWeight <= 0) {
            return null;
        }

        var secondsPerWeight = CalibrateSecondsPerWeight(
            progressPercent,
            processingStartedAtUtc,
            utcNow,
            encodeGridDone,
            encodeGridTotal);

        var seconds = (int)Math.Ceiling(remainingWeight * secondsPerWeight);
        return Math.Clamp(seconds, 5, 24 * 60 * 60);
    }

    /// <summary>
    /// Scales the estimate by how long the run has actually taken so far, so a slow machine does
    /// not keep under-promising. Clamped so an unusually fast or slow start cannot distort it.
    /// </summary>
    private static double CalibrateSecondsPerWeight(
        int progressPercent,
        DateTime? processingStartedAtUtc,
        DateTime utcNow,
        int? encodeGridDone,
        int? encodeGridTotal) {
        if (processingStartedAtUtc == null || progressPercent < MinProgressForCalibration) {
            return DefaultSecondsPerWeight;
        }

        var elapsed = (utcNow - processingStartedAtUtc.Value).TotalSeconds;
        if (elapsed < MinElapsedSecondsForCalibration) {
            return DefaultSecondsPerWeight;
        }

        var completedWeight = CompletedWeight(progressPercent, encodeGridDone, encodeGridTotal);
        if (completedWeight <= 0.5) {
            return DefaultSecondsPerWeight;
        }

        return Math.Clamp(
            elapsed / completedWeight,
            0.35 * DefaultSecondsPerWeight,
            3.0 * DefaultSecondsPerWeight);
    }

    /// <summary>Weight of everything still ahead: whole bands not started, plus the current partial one.</summary>
    private static double RemainingWeight(int progressPercent, int? gridDone, int? gridTotal) {
        double remaining = 0;

        foreach (var band in Bands) {
            if (progressPercent >= band.End) {
                continue;
            }

            remaining += progressPercent <= band.Start
                ? band.Weight
                : band.Weight * (1.0 - FractionDone(band, progressPercent, gridDone, gridTotal));
        }

        return remaining;
    }

    /// <summary>Weight of everything already behind, stopping at the band currently in progress.</summary>
    private static double CompletedWeight(int progressPercent, int? gridDone, int? gridTotal) {
        double completed = 0;

        foreach (var band in Bands) {
            if (progressPercent >= band.End) {
                completed += band.Weight;
                continue;
            }

            if (progressPercent <= band.Start) {
                break;
            }

            completed += band.Weight * FractionDone(band, progressPercent, gridDone, gridTotal);
            break;
        }

        return completed;
    }

    /// <summary>
    /// How far through a band the run is. The encode-grid band uses its real done/total count,
    /// which is far more accurate than interpolating the coarse percentage.
    /// </summary>
    private static double FractionDone(Band band, int progressPercent, int? gridDone, int? gridTotal) {
        if (band.IsEncodeGrid && gridDone.HasValue && gridTotal is > 0) {
            return Math.Clamp((double)gridDone.Value / gridTotal.Value, 0, 1);
        }

        var span = band.End - band.Start;
        return span <= 0 ? 1 : Math.Clamp((double)(progressPercent - band.Start) / span, 0, 1);
    }

    private readonly record struct Band(int Start, int End, double Weight) {
        public bool IsEncodeGrid => Start == GridStartPercent && End == GridEndPercent;
    }
}
