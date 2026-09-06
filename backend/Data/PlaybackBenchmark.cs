namespace WebWVideoStreamingAPI.Data;

/// <summary>
/// Network condition a benchmark run was measured under.
/// </summary>
/// <remarks>
/// Declared by the operator rather than enforced by the app. Page JavaScript cannot shape the link,
/// so conditions are set externally in clumsy and the label is recorded alongside the result — a
/// playback measurement without the network it was taken on is not interpretable.
/// </remarks>
public enum NetworkProfile {
    Standard = 0,
    FourG = 1,
    ThreeG = 2,

    /// <summary>Profile changes during the run; transition instants are in the trace.</summary>
    Variable = 3
}

/// <summary>What a run was measuring.</summary>
public enum BenchmarkMode {
    /// <summary>One cell of the protocol × algorithm matrix under a fixed network profile.</summary>
    Matrix = 0,

    /// <summary>A single configuration across a scripted sequence of network profiles.</summary>
    VariableNetwork = 1
}

/// <summary>
/// One playback of one configuration, measured at the client.
/// </summary>
/// <remarks>
/// Headline metrics are normalised columns because they are what the chapter 5 tables aggregate,
/// sort and chart. The per-second series and the event log go into a single JSON blob, matching how
/// <see cref="AnalysisReport"/> stores its documents — nothing in this codebase keeps a row per
/// sample, and a benchmark sweep would add tens of thousands of them.
/// </remarks>
public class PlaybackBenchmark {
    public Guid Id { get; set; }
    public Guid VideoId { get; set; }

    /// <summary>Packaging run played, or null for the original source over HTTP Range.</summary>
    public Guid? TranscodeId { get; set; }

    public BenchmarkMode Mode { get; set; }
    public NetworkProfile NetworkProfile { get; set; }

    /// <summary>Ladder, protocol and rule as the client reported them, for labelling.</summary>
    public string LadderKind { get; set; } = "";
    public string Protocol { get; set; } = "";
    public string AbrAlgorithm { get; set; } = "";

    /// <summary>Which repetition of an otherwise identical cell this was, starting at 1.</summary>
    public int Repetition { get; set; }

    /// <summary>Null when playback never produced a frame — distinct from starting instantly.</summary>
    public double? StartupMs { get; set; }

    public double BufferingRatio { get; set; }
    public int RebufferCount { get; set; }
    public double RebufferMs { get; set; }
    public int QualitySwitches { get; set; }
    public int Oscillations { get; set; }
    public double TimeWeightedBitrateBps { get; set; }
    public double DroppedFrameRatio { get; set; }

    /// <summary>Only meaningful for a variable-network run that actually lost quality.</summary>
    public double? RecoveryMs { get; set; }

    public bool Failed { get; set; }
    public string? ErrorMessage { get; set; }

    /// <summary>Per-second samples plus the event log, as one document.</summary>
    public string? TraceJson { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public Video Video { get; set; } = null!;
}
