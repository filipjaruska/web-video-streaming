using System.Globalization;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>Read-time assembly of the analysis targets the frontend renders as tabs.</summary>
public static class AnalysisTargetBuilder {
    public const string StaticLadderLabel = "Static ladder";
    public const string DynamicLadderLabel = "Dynamic ladder (VMAF crossover)";
    public const string AnimationLadderLabel = "Animation-tuned ladder";

    public static string LadderLabel(LadderKind kind) => kind switch {
        LadderKind.Dynamic => DynamicLadderLabel,
        LadderKind.AnimationTuned => AnimationLadderLabel,
        _ => StaticLadderLabel
    };

    public static string LadderToken(LadderKind kind) => kind switch {
        LadderKind.Dynamic => "dynamic",
        LadderKind.AnimationTuned => "animation",
        _ => "static"
    };

    public static List<FutureTestDescriptor> BuildFutureTests() => [
        new FutureTestDescriptor { Id = "psnr", Label = "PSNR", Status = "not_implemented" },
        new FutureTestDescriptor { Id = "ssim", Label = "SSIM", Status = "not_implemented" }
    ];

    public static AnalysisTarget BuildSourceTarget(AnalysisTreeDocument tree, AnalysisSeriesDocument series) {
        return new AnalysisTarget {
            Id = "source",
            Label = "Original upload",
            Kind = "source",
            Status = DeriveStatusFromTree(tree),
            Tree = tree,
            Series = series
        };
    }

    public static AnalysisTarget BuildTranscodeTarget(
        Transcode transcode,
        bool isActive,
        AnalysisTreeDocument? tree,
        AnalysisSeriesDocument? series) {
        var created = transcode.CreatedAtUtc.ToString("u", CultureInfo.InvariantCulture);
        var activeLabel = isActive ? " (active)" : "";
        var resolvedTree = tree ?? BuildPlaceholderTree(transcode);

        return new AnalysisTarget {
            Id = $"transcode:{transcode.Id:N}",
            Label = $"{LadderLabel(transcode.LadderKind)} · {created}{activeLabel}",
            Kind = "transcode",
            Status = DeriveTranscodeStatus(transcode, resolvedTree),
            TranscodeId = transcode.Id.ToString("N"),
            LadderKind = LadderToken(transcode.LadderKind),
            Tree = resolvedTree,
            Series = series ?? new AnalysisSeriesDocument()
        };
    }

    /// <summary>
    /// Stand-in tree for a packaging run with no stored report — either it has not been analyzed
    /// yet, or it predates analysis collection.
    /// </summary>
    private static AnalysisTreeDocument BuildPlaceholderTree(Transcode transcode) {
        const string noReport =
            "No analysis collected for this packaging run. Re-upload to generate probe and SI/TI data.";

        var (status, hlsError, dashError) = transcode.Status switch {
            TranscodeStatus.Running => (AnalysisSectionStatus.Running, null, null),
            TranscodeStatus.Failed => (
                AnalysisSectionStatus.Failed,
                transcode.ErrorMessage ?? "Transcode failed",
                transcode.ErrorMessage ?? "Transcode failed"),
            TranscodeStatus.Succeeded => (
                AnalysisSectionStatus.Completed,
                transcode.HasHls ? noReport : "HLS not produced for this packaging run",
                transcode.HasDash ? noReport : "DASH not produced for this packaging run"),
            _ => (AnalysisSectionStatus.Pending, null, null)
        };

        // Running means HLS is in flight and DASH has not started.
        var dashStatus = transcode.Status == TranscodeStatus.Running ? AnalysisSectionStatus.Pending : status;

        return new AnalysisTreeDocument {
            Id = $"transcode-{transcode.Id:N}",
            Label = "Transcode analysis",
            Children = [
                AnalysisNodes.Section("hls", "HLS", AnalysisNodes.TranscodeProbeSource, status, hlsError),
                AnalysisNodes.Section("dash", "DASH", AnalysisNodes.TranscodeProbeSource, dashStatus, dashError)
            ]
        };
    }

    private static string DeriveTranscodeStatus(Transcode transcode, AnalysisTreeDocument tree) {
        return transcode.Status switch {
            TranscodeStatus.Running => "running",
            TranscodeStatus.Failed => "failed",
            TranscodeStatus.Pending => "pending",
            // Succeeded packaging — the analysis sections decide.
            _ => DeriveStatusFromTree(tree)
        };
    }

    private static string DeriveStatusFromTree(AnalysisTreeDocument tree) {
        var statuses = tree.Children
            .Select(node => node.Meta?.Status)
            .Where(status => status != null)
            .ToList();

        if (statuses.Count == 0) {
            return "pending";
        }

        if (statuses.Any(status => status == AnalysisSectionStatus.Running)) {
            return "running";
        }

        // Only call the whole target failed when nothing actually completed.
        if (statuses.Any(status => status == AnalysisSectionStatus.Failed) &&
            statuses.All(status => status is AnalysisSectionStatus.Failed or AnalysisSectionStatus.Pending)) {
            return "failed";
        }

        if (statuses.Any(status => status == AnalysisSectionStatus.Completed)) {
            return "completed";
        }

        if (statuses.Any(status => status == AnalysisSectionStatus.NotImplemented)) {
            return "not_implemented";
        }

        return "pending";
    }
}
