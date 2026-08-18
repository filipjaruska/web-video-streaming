namespace WebWVideoStreamingAPI.Data;

public enum TranscodeStatus {
    Pending = 0,
    Running = 1,
    Succeeded = 2,
    Failed = 3
}

public enum LadderKind {
    Static = 0,
    Dynamic = 1,

    /// <summary>
    /// Reserved for the animation-optimized packaging run (thesis 4.3.1.3 / 4.4.3). Nothing
    /// produces one yet — the pipeline has no third pass.
    /// </summary>
    AnimationTuned = 2
}

/// <summary>One packaging run over a video: a ladder encoded to HLS and/or DASH.</summary>
public class Transcode {
    public Guid Id { get; set; }
    public Guid VideoId { get; set; }
    public TranscodeStatus Status { get; set; }
    public LadderKind LadderKind { get; set; } = LadderKind.Static;

    /// <summary>Provenance only: the ladder this run packaged. Written, never read back.</summary>
    public string? ProfileJson { get; set; }

    /// <summary>Provenance only: the static run a dynamic ladder was derived from.</summary>
    public Guid? DerivedFromTranscodeId { get; set; }

    public bool HasHls { get; set; }
    public bool HasDash { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? StartedAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }

    public Video Video { get; set; } = null!;
}
