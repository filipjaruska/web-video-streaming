using System.Globalization;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public static class AnalysisTargetBuilder {
    private const string TempPrefix = "[temp]";

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
        var created = transcode.CreatedAtUtc.ToString("u", CultureInfo.InvariantCulture);
        var activeLabel = isActive ? " (active)" : "";

        return new AnalysisTarget {
            Id = $"transcode:{transcode.Id:N}",
            Label = $"Transcode · {created}{activeLabel}",
            Kind = "transcode",
            Status = DeriveTranscodeScaffoldStatus(transcode),
            TranscodeId = transcode.Id.ToString("N"),
            Tree = BuildTranscodeScaffoldTree(transcode),
            Series = new AnalysisSeriesDocument()
        };
    }

    private static AnalysisTreeDocument BuildTranscodeScaffoldTree(Transcode transcode) {
        return new AnalysisTreeDocument {
            Id = $"transcode-{transcode.Id:N}",
            Label = "Transcode analysis",
            Children = [
                BuildHlsSection(transcode),
                BuildDashSection(transcode)
            ]
        };
    }

    private static AnalysisTreeNode BuildHlsSection(Transcode transcode) {
        if (!transcode.HasHls) {
            return FormatSection(
                "hls",
                "HLS",
                "ffprobe-transcode",
                AnalysisSectionStatus.Pending,
                error: "HLS not produced for this packaging run",
                children: null);
        }

        return FormatSection(
            "hls",
            "HLS",
            "ffprobe-transcode",
            AnalysisSectionStatus.NotImplemented,
            children: [
                ScaffoldSection("hls.general", "General", [
                    TempLeaf("hls.general.playlist", "Master playlist", "hls/master.m3u8"),
                    TempLeaf("hls.general.format", "Format", "HLS / MPEG-TS"),
                    TempLeaf("hls.general.variants", "Variant count", "2"),
                    TempLeaf("hls.general.note", "Scaffold note", "Placeholder metadata — not probed yet")
                ]),
                ScaffoldSection("hls.1080p", "1080p", [
                    TempLeaf("hls.1080p.playlist", "Media playlist", "hls/1080p.m3u8"),
                    TempLeaf("hls.1080p.resolution", "Resolution", "1920x1080"),
                    TempLeaf("hls.1080p.bitrate", "Bit rate", "5.00 Mb/s"),
                    TempLeaf("hls.1080p.codec", "Codec", "H.264 / AAC"),
                    TempLeaf("hls.1080p.segment", "Segment duration", "6.000 s")
                ]),
                ScaffoldSection("hls.360p", "360p", [
                    TempLeaf("hls.360p.playlist", "Media playlist", "hls/360p.m3u8"),
                    TempLeaf("hls.360p.resolution", "Resolution", "640x360"),
                    TempLeaf("hls.360p.bitrate", "Bit rate", "800 kb/s"),
                    TempLeaf("hls.360p.codec", "Codec", "H.264 / AAC"),
                    TempLeaf("hls.360p.segment", "Segment duration", "6.000 s")
                ]),
                ScaffoldSection("hls.siti", "SI/TI (per rendition)", [
                    TempLeaf("hls.siti.1080p_avg_si", "1080p Average SI", "—"),
                    TempLeaf("hls.siti.1080p_avg_ti", "1080p Average TI", "—"),
                    TempLeaf("hls.siti.360p_avg_si", "360p Average SI", "—"),
                    TempLeaf("hls.siti.360p_avg_ti", "360p Average TI", "—"),
                    TempLeaf("hls.siti.note", "Scaffold note", "Will run ffmpeg siti on each ladder rung")
                ])
            ]);
    }

    private static AnalysisTreeNode BuildDashSection(Transcode transcode) {
        if (!transcode.HasDash) {
            return FormatSection(
                "dash",
                "DASH",
                "ffprobe-transcode",
                AnalysisSectionStatus.Pending,
                error: "DASH not produced for this packaging run",
                children: null);
        }

        return FormatSection(
            "dash",
            "DASH",
            "ffprobe-transcode",
            AnalysisSectionStatus.NotImplemented,
            children: [
                ScaffoldSection("dash.general", "General", [
                    TempLeaf("dash.general.manifest", "Manifest", "dash/manifest.mpd"),
                    TempLeaf("dash.general.format", "Format", "MPEG-DASH / fMP4"),
                    TempLeaf("dash.general.profiles", "Profiles", "urn:mpeg:dash:profile:isoff-live:2011"),
                    TempLeaf("dash.general.note", "Scaffold note", "Placeholder metadata — not probed yet")
                ]),
                ScaffoldSection("dash.video", "Video adaptation set", [
                    TempLeaf("dash.video.reps", "Representations", "2"),
                    TempLeaf("dash.video.1080p", "1080p bandwidth", "5_000_000"),
                    TempLeaf("dash.video.360p", "360p bandwidth", "800_000"),
                    TempLeaf("dash.video.codec", "Codecs", "avc1.640028")
                ]),
                ScaffoldSection("dash.audio", "Audio adaptation set", [
                    TempLeaf("dash.audio.reps", "Representations", "1"),
                    TempLeaf("dash.audio.codec", "Codec", "mp4a.40.2"),
                    TempLeaf("dash.audio.sample_rate", "Sampling rate", "48 kHz")
                ]),
                ScaffoldSection("dash.siti", "SI/TI (per representation)", [
                    TempLeaf("dash.siti.avg_si", "Average SI", "—"),
                    TempLeaf("dash.siti.avg_ti", "Average TI", "—"),
                    TempLeaf("dash.siti.note", "Scaffold note", "Will run ffmpeg siti on DASH video reps")
                ])
            ]);
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

    private static AnalysisTreeNode ScaffoldSection(string id, string label, List<AnalysisTreeNode> children) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = "scaffold",
                Status = AnalysisSectionStatus.NotImplemented,
                Kind = "section"
            },
            Children = children
        };
    }

    private static AnalysisTreeNode TempLeaf(string id, string label, string value) {
        return new AnalysisTreeNode {
            Id = id,
            Label = label,
            Value = $"{TempPrefix} {value}"
        };
    }

    private static string DeriveTranscodeScaffoldStatus(Transcode transcode) {
        return transcode.Status switch {
            TranscodeStatus.Running => "running",
            TranscodeStatus.Succeeded => "not_implemented",
            TranscodeStatus.Failed => "failed",
            _ => "pending"
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
