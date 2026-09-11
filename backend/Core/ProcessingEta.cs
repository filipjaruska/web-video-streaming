using WebWVideoStreamingAPI.Analysis;

namespace WebWVideoStreamingAPI.Core;

/// <summary>Every point the pipeline reports progress from, in the order the pipeline runs them.</summary>
/// <remarks>The order is load-bearing: the time estimate treats every step after the current one as still ahead.</remarks>
public enum PipelineStep {
    Starting,
    Subtitles,
    MediaInfo,
    SourceSiti,
    SourceCambi,
    Thumbnail,
    AudioEncode,
    StaticEncode,
    StaticPackage,
    StaticSiti,
    StaticVmaf,
    EncodeGrid,
    DeriveLadder,
    DynamicEncode,
    DynamicPackage,
    DynamicSiti,
    DynamicVmaf,
    AnimationGrid,
    AnimationDeriveLadder,
    AnimationEncode,
    AnimationPackage,
    AnimationSiti,
    AnimationVmaf,
    TuningComparison,
    LadderComparison
}

/// <summary>
/// The single table of pipeline steps: the label each reports, the percentage it starts at, and the
/// default cost the time estimate starts from before a run has told it anything.
/// </summary>
public static class ProcessingEta {
    /// <summary>Workload the default costs describe: the Frieren clip, 735 frames of 1920×1080.</summary>
    internal const long ReferenceFrames = 735;
    internal const long ReferencePixels = 1920L * 1080;

    /// <summary>Samples a grid is assumed to take until it reports its own count.</summary>
    internal const int ExpectedGridSamples = Analysis.EncodeGrid.MaxSamplesTotal;

    /// <summary>
    /// Label and default wall time, in seconds on the development machine for the reference workload.
    /// Grid steps are per sample.
    /// </summary>
    /// <remarks>
    /// The per-sample grid costs (34 s generic, 30 s animation) are measured from the first full
    /// run, which took 72 min 37 s. The encode and analysis steps were restructured after that run,
    /// so their figures are estimates; each run corrects them against its own pace within minutes,
    /// and the next run starts from this one's measured timings instead.
    /// </remarks>
    private static readonly Dictionary<PipelineStep, (string Label, double Seconds)> Steps = new() {
        [PipelineStep.Starting] = ("Preparing source", 2),
        [PipelineStep.Subtitles] = ("Extracting subtitles", 12),
        [PipelineStep.MediaInfo] = ("Reading media info", 2),
        [PipelineStep.SourceSiti] = ("SI/TI analysis", 25),
        [PipelineStep.SourceCambi] = ("Source banding (CAMBI)", 45),
        [PipelineStep.Thumbnail] = ("Generating thumbnail", 3),
        [PipelineStep.AudioEncode] = ("Encoding audio", 3),
        [PipelineStep.StaticEncode] = ("Encoding static ladder", 150),
        [PipelineStep.StaticPackage] = ("Packaging static ladder (HLS + DASH)", 8),
        [PipelineStep.StaticSiti] = ("Analyzing static ladder (SI/TI)", 45),
        [PipelineStep.StaticVmaf] = ("Static ladder VMAF", 120),
        [PipelineStep.EncodeGrid] = ("Encode grid", 34),
        [PipelineStep.DeriveLadder] = ("Deriving VMAF crossover ladder", 1),
        [PipelineStep.DynamicEncode] = ("Encoding dynamic ladder", 140),
        [PipelineStep.DynamicPackage] = ("Packaging dynamic ladder (HLS + DASH)", 8),
        [PipelineStep.DynamicSiti] = ("Analyzing dynamic ladder (SI/TI)", 40),
        [PipelineStep.DynamicVmaf] = ("Dynamic ladder VMAF", 105),
        [PipelineStep.AnimationGrid] = ("Encode grid — animation tuning", 30),
        [PipelineStep.AnimationDeriveLadder] = ("Deriving animation-tuned ladder", 1),
        [PipelineStep.AnimationEncode] = ("Encoding animation ladder", 140),
        [PipelineStep.AnimationPackage] = ("Packaging animation ladder (HLS + DASH)", 8),
        [PipelineStep.AnimationSiti] = ("Analyzing animation ladder (SI/TI)", 40),
        [PipelineStep.AnimationVmaf] = ("Animation ladder VMAF", 105),
        [PipelineStep.TuningComparison] = ("Comparing codec tuning", 1),
        [PipelineStep.LadderComparison] = ("Comparing ladders (BD-rate)", 1)
    };

    internal static readonly PipelineStep[] Order = Enum.GetValues<PipelineStep>();

    /// <summary>
    /// Each step's starting percentage, proportional to the default time before it — so the bar moves
    /// at roughly constant speed instead of racing through the cheap steps and parking on the grids.
    /// </summary>
    private static readonly Dictionary<PipelineStep, int> Percents = BuildPercents();

    public static int PercentFor(PipelineStep step) => Percents[step];

    public static string LabelFor(PipelineStep step) => Steps[step].Label;

    /// <summary>Maps progress inside a step (grid samples, encoded rungs) onto that step's share of the bar.</summary>
    public static int SubPercent(PipelineStep step, int done, int total) {
        var start = PercentFor(step);
        var end = NextPercent(step);
        if (total <= 0) {
            return start;
        }

        var percent = start + (int)Math.Round((end - start) * (double)Math.Clamp(done, 0, total) / total);
        return Math.Clamp(percent, start, end);
    }

    public static string SubLabel(PipelineStep step, int done, int total) => $"{LabelFor(step)} ({done}/{total})";

    internal static bool IsGrid(PipelineStep step) => step is PipelineStep.EncodeGrid or PipelineStep.AnimationGrid;

    internal static double DefaultSeconds(PipelineStep step) => Steps[step].Seconds;

    internal static double DefaultCost(PipelineStep step) =>
        IsGrid(step) ? DefaultSeconds(step) * ExpectedGridSamples : DefaultSeconds(step);

    /// <summary>
    /// The earlier step doing the same work on another ladder, whose measured time predicts this
    /// one better than any prior can: the three ladders encode, package and score the same clip.
    /// </summary>
    internal static PipelineStep? AnalogOf(PipelineStep step) => step switch {
        PipelineStep.DynamicEncode => PipelineStep.StaticEncode,
        PipelineStep.DynamicPackage => PipelineStep.StaticPackage,
        PipelineStep.DynamicSiti => PipelineStep.StaticSiti,
        PipelineStep.DynamicVmaf => PipelineStep.StaticVmaf,
        PipelineStep.AnimationEncode => PipelineStep.DynamicEncode,
        PipelineStep.AnimationPackage => PipelineStep.DynamicPackage,
        PipelineStep.AnimationSiti => PipelineStep.DynamicSiti,
        PipelineStep.AnimationVmaf => PipelineStep.DynamicVmaf,
        PipelineStep.AnimationGrid => PipelineStep.EncodeGrid,
        _ => null
    };

    private static int NextPercent(PipelineStep step) {
        var index = Array.IndexOf(Order, step);
        return index + 1 < Order.Length ? Percents[Order[index + 1]] : 99;
    }

    private static Dictionary<PipelineStep, int> BuildPercents() {
        var total = Order.Sum(DefaultCost);
        var percents = new Dictionary<PipelineStep, int>();
        double before = 0;

        foreach (var step in Order) {
            percents[step] = 1 + (int)Math.Floor(98 * before / total);
            before += DefaultCost(step);
        }

        return percents;
    }
}

/// <summary>
/// Time remaining for one pipeline run, predicted per step in seconds and corrected by the run itself.
/// </summary>
/// <remarks>
/// <para>
/// The prior is the last completed run's measured stage timings, else <see cref="ProcessingEta"/>'s
/// defaults, scaled by the source's frames × pixels. The old estimate converted percent into time at
/// a fixed 4.5 s per weight unit and capped its correction at 3×; the first full run measured
/// roughly three times that, so the estimate was pinned at a third of reality for the whole run.
/// </para>
/// <para>
/// In-run corrections, in order of preference: a step whose analog on an earlier ladder has
/// finished is predicted from that step's actual time; a grid refits its per-sample time once it has
/// a few samples; everything else is scaled by how completed steps compared with their prior,
/// weighted by how much evidence there is.
/// </para>
/// </remarks>
public sealed class ProcessingEtaTracker {
    private const double MinRatio = 0.33;
    private const double MaxRatio = 3.0;

    /// <summary>Seconds of completed prediction at which the run's own pace gets half the weight.</summary>
    private const double CalibrationHalfWeightSeconds = 120;

    /// <summary>Pseudo-samples of the prior blended into a grid's running per-sample time.</summary>
    private const int GridShrinkSamples = 3;

    private readonly IReadOnlyDictionary<string, StageTiming>? _prior;
    private readonly Dictionary<PipelineStep, CompletedStep> _completed = [];
    private long _frames = ProcessingEta.ReferenceFrames;
    private long _pixels = ProcessingEta.ReferencePixels;
    private PipelineStep? _current;
    private DateTime _currentStartedUtc;
    private int? _unitsDone;
    private int? _unitsTotal;

    private sealed record CompletedStep(double Seconds, int? Units);

    public ProcessingEtaTracker(IReadOnlyDictionary<string, StageTiming>? prior = null) {
        _prior = prior;
    }

    public void SetWorkload(long frames, long pixelsPerFrame) {
        if (frames > 0 && pixelsPerFrame > 0) {
            _frames = frames;
            _pixels = pixelsPerFrame;
        }
    }

    /// <summary>Starts a step, closing the previous one. Re-reporting the current step is a no-op.</summary>
    public void Begin(PipelineStep step, DateTime utcNow) {
        if (_current == step) {
            return;
        }

        Close(utcNow);
        _current = step;
        _currentStartedUtc = utcNow;
        _unitsDone = null;
        _unitsTotal = null;
    }

    /// <summary>Progress inside the current step — grid samples or encoded rungs.</summary>
    public void Progress(int done, int total) {
        _unitsDone = done;
        _unitsTotal = total;
    }

    public void Finish(DateTime utcNow) {
        Close(utcNow);
        _current = null;
    }

    public int? EstimateRemainingSeconds(DateTime utcNow) {
        if (_current is not { } current) {
            return null;
        }

        var ratio = CalibrationRatio();
        var elapsed = Math.Max(0, (utcNow - _currentStartedUtc).TotalSeconds);
        var remaining = RemainingInCurrent(current, elapsed, ratio);

        foreach (var step in ProcessingEta.Order) {
            if (step > current && !_completed.ContainsKey(step)) {
                remaining += Predict(step, units: null, ratio);
            }
        }

        return (int)Math.Clamp(Math.Ceiling(remaining), 0, 24 * 60 * 60);
    }

    /// <summary>Measured wall time of every finished step, to be stored as the next run's prior.</summary>
    public Dictionary<string, StageTiming> Timings() =>
        _completed.ToDictionary(
            pair => pair.Key.ToString(),
            pair => new StageTiming {
                DurationMs = (long)Math.Round(pair.Value.Seconds * 1000),
                Frames = (int)_frames,
                Pixels = _pixels,
                Count = pair.Value.Units
            });

    private void Close(DateTime utcNow) {
        if (_current is not { } step) {
            return;
        }

        _completed[step] = new CompletedStep(Math.Max(0, (utcNow - _currentStartedUtc).TotalSeconds), _unitsTotal);
    }

    private double RemainingInCurrent(PipelineStep step, double elapsed, double ratio) {
        var predicted = Predict(step, _unitsTotal, ratio);

        if (ProcessingEta.IsGrid(step) &&
            _unitsDone is { } done && done > 0 &&
            _unitsTotal is { } total && total > 0) {
            var predictedPerSample = predicted / total;
            var perSample = (elapsed + GridShrinkSamples * predictedPerSample) / (done + GridShrinkSamples);
            return Math.Max(0, total - done) * perSample;
        }

        return Math.Max(0, predicted - elapsed);
    }

    private double Predict(PipelineStep step, int? units, double ratio) {
        var prior = PriorSeconds(step, units);

        for (var analog = ProcessingEta.AnalogOf(step); analog is { } candidate; analog = ProcessingEta.AnalogOf(candidate)) {
            if (!_completed.TryGetValue(candidate, out var finished)) {
                continue;
            }

            var analogPrior = PriorSeconds(candidate, finished.Units);
            return analogPrior > 0 ? finished.Seconds * prior / analogPrior : prior * ratio;
        }

        return prior * ratio;
    }

    /// <summary>Actual over prior across finished steps, shrunk towards 1 while there is little evidence.</summary>
    private double CalibrationRatio() {
        double actual = 0;
        double predicted = 0;

        foreach (var (step, finished) in _completed) {
            var prior = PriorSeconds(step, finished.Units);
            if (prior < 1) {
                continue;
            }

            actual += finished.Seconds;
            predicted += prior;
        }

        if (predicted <= 0) {
            return 1;
        }

        var weight = predicted / (predicted + CalibrationHalfWeightSeconds);
        return Math.Clamp(1 + (actual / predicted - 1) * weight, MinRatio, MaxRatio);
    }

    private double PriorSeconds(PipelineStep step, int? units) {
        var perSample = ProcessingEta.IsGrid(step);

        if (_prior != null &&
            _prior.TryGetValue(step.ToString(), out var timing) &&
            timing.DurationMs > 0) {
            var seconds = timing.DurationMs / 1000.0 * Scale(timing.Frames, timing.Pixels);
            return perSample && timing.Count is > 0
                ? seconds / timing.Count.Value * (units ?? timing.Count.Value)
                : seconds;
        }

        var defaults = ProcessingEta.DefaultSeconds(step) * Scale(null, null);
        return perSample ? defaults * (units ?? ProcessingEta.ExpectedGridSamples) : defaults;
    }

    /// <summary>This run's frames × pixels over the prior's. Every heavy step is linear in both.</summary>
    private double Scale(int? frames, long? pixels) {
        var priorWork = (double)(frames ?? ProcessingEta.ReferenceFrames) * (pixels ?? ProcessingEta.ReferencePixels);
        return priorWork > 0 ? (double)_frames * _pixels / priorWork : 1;
    }
}
