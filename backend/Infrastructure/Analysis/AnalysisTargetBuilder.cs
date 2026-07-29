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
        var status = DeriveSourceStatus(tree);

        return new AnalysisTarget {
            Id = "source",
            Label = "Original upload",
            Kind = "source",
            Status = status,
            Tree = tree,
            Series = series
        };
    }

    public static AnalysisTarget BuildTranscodeTarget(Transcode transcode, bool isActive) {
        var formats = new List<string>();
        if (transcode.HasHls) {
            formats.Add("HLS");
        }
        if (transcode.HasDash) {
            formats.Add("DASH");
        }

        var formatLabel = formats.Count > 0 ? string.Join(" + ", formats) : "no outputs";
        var activeLabel = isActive ? " (active)" : "";
        var created = transcode.CreatedAtUtc.ToString("u", CultureInfo.InvariantCulture);

        return new AnalysisTarget {
            Id = $"transcode:{transcode.Id:N}",
            Label = $"Transcode {created}{activeLabel} — {formatLabel}",
            Kind = "transcode",
            Status = "pending",
            TranscodeId = transcode.Id.ToString("N"),
            Tree = BuildTranscodeScaffoldTree(transcode),
            Series = new AnalysisSeriesDocument()
        };
    }

    private static AnalysisTreeDocument BuildTranscodeScaffoldTree(Transcode transcode) {
        var children = new List<AnalysisTreeNode>();

        if (transcode.HasHls) {
            children.Add(PendingSection(
                "hls-1080p",
                "HLS 1080p probe",
                "ffprobe-transcode"));
            children.Add(PendingSection(
                "hls-360p",
                "HLS 360p probe",
                "ffprobe-transcode"));
        } else {
            children.Add(PendingSection(
                "hls",
                "HLS outputs",
                "ffprobe-transcode",
                "HLS not produced for this transcode"));
        }

        if (transcode.HasDash) {
            children.Add(PendingSection(
                "dash-manifest",
                "DASH manifest / segments",
                "ffprobe-transcode"));
        } else {
            children.Add(PendingSection(
                "dash",
                "DASH outputs",
                "ffprobe-transcode",
                "DASH not produced for this transcode"));
        }

        children.Add(PendingSection(
            "per-output-siti",
            "Per-output SI/TI",
            "ffmpeg-siti"));

        return new AnalysisTreeDocument {
            Id = $"transcode-{transcode.Id:N}",
            Label = "Transcode analysis",
            Children = children
        };
    }

    private static AnalysisTreeNode PendingSection(
        string id,
        string label,
        string source,
        string? error = null) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = AnalysisSectionStatus.Pending,
                Kind = "section",
                Error = error
            }
        };
    }

    private static string DeriveSourceStatus(AnalysisTreeDocument tree) {
        if (tree.Children.Count == 0) {
            return "pending";
        }

        var statuses = tree.Children
            .Select(node => node.Meta?.Status)
            .Where(status => status != null)
            .ToList();

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

        return "pending";
    }
}
