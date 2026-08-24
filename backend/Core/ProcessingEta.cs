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
    DynamicVmaf,
    AnimationGrid,
    AnimationDeriveLadder,
    AnimationHls,
    AnimationDash,
    AnimationSiti,
    AnimationVmaf,
    TuningComparison,
    LadderComparison
}

/// <summary>
/// The single table of pipeline progress. It owns both the percentage and label each step reports,
/// and the relative cost weights used to turn a percentage into a time estimate — previously these
/// lived in two files and had to be kept in sync by hand.
/// </summary>
public static class ProcessingEta {
    /// <summary>Percent range the generic encode grid's sub-progress is mapped across.</summary>
    public const int GridStartPercent = 26;
    public const int GridEndPercent = 52;

    /// <summary>Percent range the animation encode grid's sub-progress is mapped across.</summary>
    public const int AnimationGridStartPercent = 63;
    public const int AnimationGridEndPercent = 89;

    private static readonly Dictionary<PipelineStep, (int Percent, string Label)> Steps = new() {
        [PipelineStep.Starting] = (8, "Preparing source"),
        [PipelineStep.MediaInfo] = (10, "Reading media info"),
        [PipelineStep.Subtitles] = (12, "Extracting subtitles"),
        [PipelineStep.SourceSiti] = (14, "SI/TI analysis"),
        [PipelineStep.Thumbnail] = (16, "Generating thumbnail"),
        [PipelineStep.StaticHls] = (18, "HLS transcoding"),
        [PipelineStep.StaticDash] = (20, "DASH transcoding"),
        [PipelineStep.StaticSiti] = (22, "Analyzing transcodes (SI/TI)"),
        [PipelineStep.StaticVmaf] = (24, "VMAF analysis"),
        [PipelineStep.EncodeGrid] = (GridStartPercent, "Encode grid (CRF × resolution)"),
        [PipelineStep.DeriveLadder] = (52, "Deriving VMAF crossover ladder"),
        [PipelineStep.DynamicHls] = (53, "Dynamic HLS packaging"),
        [PipelineStep.DynamicDash] = (55, "Dynamic DASH packaging"),
        [PipelineStep.DynamicSiti] = (57, "Analyzing dynamic ladder (SI/TI)"),
        [PipelineStep.DynamicVmaf] = (59, "Dynamic ladder VMAF"),
        [PipelineStep.AnimationGrid] = (AnimationGridStartPercent, "Encode grid (animation tuning)"),
        [PipelineStep.AnimationDeriveLadder] = (89, "Deriving animation-tuned ladder"),
        [PipelineStep.AnimationHls] = (90, "Animation HLS packaging"),
        [PipelineStep.AnimationDash] = (92, "Animation DASH packaging"),
        [PipelineStep.AnimationSiti] = (94, "Analyzing animation ladder (SI/TI)"),
        [PipelineStep.AnimationVmaf] = (96, "Animation ladder VMAF"),
        [PipelineStep.TuningComparison] = (98, "Comparing codec tuning"),
        [PipelineStep.LadderComparison] = (99, "Comparing ladders (BD-rate)")
    };

    // Relative cost of the work spanning each percentage band (arbitrary units, not seconds).
    // Each grid encodes and scores ~45 samples over the whole clip, roughly three times the work of
    // a full packaging pass, so the two grids together dominate everything else combined.
    private static readonly Band[] Bands = [
        new(8, 10, 2),
        new(10, 12, 3),
        new(12, 14, 3),
        new(14, 16, 8),
        new(16, 18, 1),
        new(18, 20, 8),
        new(20, 22, 8),
        new(22, 24, 6),
        new(24, GridStartPercent, 10),
        new(GridStartPercent, GridEndPercent, 90),
        new(52, 53, 1),
        new(53, 55, 8),
        new(55, 57, 8),
        new(57, 59, 6),
        new(59, 61, 10),
        new(61, AnimationGridStartPercent, 1),
        new(AnimationGridStartPercent, AnimationGridEndPercent, 90),
        new(89, 90, 1),
        new(90, 92, 8),
        new(92, 94, 8),
        new(94, 96, 6),
        new(96, 98, 10),
        new(98, 99, 1),
        new(99, 100, 1)
    ];

    private const double DefaultSecondsPerWeight = 4.5;
    private const int MinProgressForEta = 8;
    private const int MinProgressForCalibration = 20;
    private const int MinElapsedSecondsForCalibration = 30;

    public static int PercentFor(PipelineStep step) => Steps[step].Percent;

    public static string LabelFor(PipelineStep step) => Steps[step].Label;

    /// <summary>Maps encode-grid completion onto the percentage band reserved for that grid.</summary>
    public static int GridPercent(int done, int total, PipelineStep step = PipelineStep.EncodeGrid) {
        var (start, end) = BandFor(step);
        if (total <= 0) {
            return start;
        }

        var percent = start + (int)Math.Round((double)(end - start) * done / total);
        return Math.Clamp(percent, start, end);
    }

    public static string GridLabel(int done, int total, PipelineStep step = PipelineStep.EncodeGrid) =>
        step == PipelineStep.AnimationGrid
            ? $"Encode grid — animation ({done}/{total})"
            : $"Encode grid ({done}/{total})";

    private static (int Start, int End) BandFor(PipelineStep step) =>
        step == PipelineStep.AnimationGrid
            ? (AnimationGridStartPercent, AnimationGridEndPercent)
            : (GridStartPercent, GridEndPercent);

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
        /// <summary>Either encode-grid band — both report a real done/total the ETA can use.</summary>
        public bool IsEncodeGrid =>
            (Start == GridStartPercent && End == GridEndPercent) ||
            (Start == AnimationGridStartPercent && End == AnimationGridEndPercent);
    }
}
