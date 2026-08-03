using System.Globalization;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public static class AnalysisTargetBuilder {
    public static List<FutureTestDescriptor> BuildFutureTests() {
        return [
            new FutureTestDescriptor {
                Id = "vmaf",
                Label = "VMAF",
                Status = "not_implemented"
            },
            new FutureTestDescriptor {
                Id = "psnr",
                Label = "PSNR",
                Status = "not_implemented"
            },
            new FutureTestDescriptor {
                Id = "ssim",
                Label = "SSIM",
                Status = "not_implemented"
            }
        ];
    }

    public static AnalysisTarget BuildSourceTarget(
        AnalysisTreeDocument tree,
        AnalysisSeriesDocument series) {
        var status = DeriveStatusFromTree(tree);

        return new AnalysisTarget {
            Id = "source",
            Label = "Original upload",
            Kind = "source",
            Status = status,
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
        var resolvedTree = tree ?? BuildPendingTranscodeTree(transcode);
        var resolvedSeries = series ?? new AnalysisSeriesDocument();

        return new AnalysisTarget {
            Id = $"transcode:{transcode.Id:N}",
            Label = $"Transcode · {created}{activeLabel}",
            Kind = "transcode",
            Status = DeriveTranscodeStatus(transcode, resolvedTree),
            TranscodeId = transcode.Id.ToString("N"),
            Tree = resolvedTree,
            Series = resolvedSeries
        };
    }

    private static AnalysisTreeDocument BuildPendingTranscodeTree(Transcode transcode) {
        var children = new List<AnalysisTreeNode>();

        if (transcode.Status == TranscodeStatus.Running) {
            children.Add(FormatSection(
                "hls",
                "HLS",
                "ffprobe-transcode",
                AnalysisSectionStatus.Running));
            children.Add(FormatSection(
                "dash",
                "DASH",
                "ffprobe-transcode",
                AnalysisSectionStatus.Pending));
        } else if (transcode.Status == TranscodeStatus.Failed) {
            children.Add(FormatSection(
                "hls",
                "HLS",
                "ffprobe-transcode",
                AnalysisSectionStatus.Failed,
                error: transcode.ErrorMessage ?? "Transcode failed"));
            children.Add(FormatSection(
                "dash",
                "DASH",
                "ffprobe-transcode",
                AnalysisSectionStatus.Failed,
                error: transcode.ErrorMessage ?? "Transcode failed"));
        } else if (transcode.Status == TranscodeStatus.Succeeded) {
            // Packaging finished without a persisted analysis report (legacy runs).
            children.Add(FormatSection(
                "hls",
                "HLS",
                "ffprobe-transcode",
                AnalysisSectionStatus.Completed,
                error: transcode.HasHls
                    ? "No analysis collected for this packaging run. Re-upload to generate probe and SI/TI data."
                    : "HLS not produced for this packaging run"));
            children.Add(FormatSection(
                "dash",
                "DASH",
                "ffprobe-transcode",
                AnalysisSectionStatus.Completed,
                error: transcode.HasDash
                    ? "No analysis collected for this packaging run. Re-upload to generate probe and SI/TI data."
                    : "DASH not produced for this packaging run"));
        } else {
            children.Add(FormatSection(
                "hls",
                "HLS",
                "ffprobe-transcode",
                AnalysisSectionStatus.Pending));
            children.Add(FormatSection(
                "dash",
                "DASH",
                "ffprobe-transcode",
                AnalysisSectionStatus.Pending));
        }

        return new AnalysisTreeDocument {
            Id = $"transcode-{transcode.Id:N}",
            Label = "Transcode analysis",
            Children = children
        };
    }

    private static AnalysisTreeNode FormatSection(
        string id,
        string label,
        string source,
        AnalysisSectionStatus status,
        string? error = null,
        List<AnalysisTreeNode>? children = null) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = status,
                Kind = "section",
                Error = error
            },
            Children = children
        };
    }

    private static string DeriveTranscodeStatus(Transcode transcode, AnalysisTreeDocument tree) {
        if (transcode.Status == TranscodeStatus.Running) {
            return "running";
        }

        if (transcode.Status == TranscodeStatus.Failed) {
            return "failed";
        }

        if (transcode.Status == TranscodeStatus.Pending) {
            return "pending";
        }

        // Succeeded packaging — derive from analysis tree sections when present.
        if (tree.Children.Count == 0) {
            return "pending";
        }

        return DeriveStatusFromTree(tree);
    }

    private static string DeriveStatusFromTree(AnalysisTreeDocument tree) {
        if (tree.Children.Count == 0) {
            return "pending";
        }

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
