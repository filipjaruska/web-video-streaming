using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public interface IVideoSourceAnalysisService {
    Task<VideoSourceAnalysis> GetOrCreateAsync(Guid videoId, CancellationToken cancellationToken = default);
    Task MarkSectionRunningAsync(Guid videoId, string sectionId, string label, string source, CancellationToken cancellationToken = default);
    Task UpsertSectionAsync(Guid videoId, AnalysisTreeNode section, CancellationToken cancellationToken = default);
    Task UpsertSectionsAsync(Guid videoId, IEnumerable<AnalysisTreeNode> sections, CancellationToken cancellationToken = default);
    Task SetSeriesAsync(Guid videoId, string key, SitiSeriesData series, CancellationToken cancellationToken = default);
    Task MarkSectionFailedAsync(Guid videoId, string sectionId, string label, string source, string error, CancellationToken cancellationToken = default);
    Task<VideoAnalysisDto?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default);
}

public class VideoSourceAnalysisService : IVideoSourceAnalysisService {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly AppDbContext _dbContext;

    public VideoSourceAnalysisService(AppDbContext dbContext) {
        _dbContext = dbContext;
    }

    public async Task<VideoSourceAnalysis> GetOrCreateAsync(Guid videoId, CancellationToken cancellationToken = default) {
        var existing = await _dbContext.VideoSourceAnalyses
            .FirstOrDefaultAsync(analysis => analysis.VideoId == videoId, cancellationToken);

        if (existing != null) {
            return existing;
        }

        var report = new VideoSourceAnalysis {
            VideoId = videoId,
            SchemaVersion = 2,
            TreeJson = SerializeTree(new AnalysisTreeDocument()),
            SeriesJson = SerializeSeries(new AnalysisSeriesDocument()),
            UpdatedAtUtc = DateTime.UtcNow
        };

        _dbContext.VideoSourceAnalyses.Add(report);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return report;
    }

    public async Task MarkSectionRunningAsync(
        Guid videoId,
        string sectionId,
        string label,
        string source,
        CancellationToken cancellationToken = default) {
        var section = new AnalysisTreeNode {
            Id = sectionId,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = AnalysisSectionStatus.Running,
                Kind = "section"
            }
        };

        await UpsertSectionAsync(videoId, section, cancellationToken);
    }

    public async Task UpsertSectionAsync(Guid videoId, AnalysisTreeNode section, CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(videoId, cancellationToken);
        var tree = DeserializeTree(report.TreeJson);

        var index = tree.Children.FindIndex(node => node.Id == section.Id);
        if (index >= 0) {
            tree.Children[index] = section;
        } else {
            tree.Children.Add(section);
        }

        report.TreeJson = SerializeTree(tree);
        report.SchemaVersion = 2;
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task UpsertSectionsAsync(
        Guid videoId,
        IEnumerable<AnalysisTreeNode> sections,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(videoId, cancellationToken);
        var tree = DeserializeTree(report.TreeJson);

        foreach (var section in sections) {
            var index = tree.Children.FindIndex(node => node.Id == section.Id);
            if (index >= 0) {
                tree.Children[index] = section;
            } else {
                tree.Children.Add(section);
            }
        }

        report.TreeJson = SerializeTree(tree);
        report.SchemaVersion = 2;
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task SetSeriesAsync(
        Guid videoId,
        string key,
        SitiSeriesData series,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(videoId, cancellationToken);
        var seriesDoc = DeserializeSeries(report.SeriesJson) ?? new AnalysisSeriesDocument();

        if (key == "siti") {
            seriesDoc.Siti = series;
        }

        report.SeriesJson = SerializeSeries(seriesDoc);
        report.SchemaVersion = 2;
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkSectionFailedAsync(
        Guid videoId,
        string sectionId,
        string label,
        string source,
        string error,
        CancellationToken cancellationToken = default) {
        var section = new AnalysisTreeNode {
            Id = sectionId,
            Label = label,
            Meta = new AnalysisTreeNodeMeta {
                Source = source,
                Status = AnalysisSectionStatus.Failed,
                Kind = "section",
                Error = error
            }
        };

        await UpsertSectionAsync(videoId, section, cancellationToken);
    }

    public async Task<VideoAnalysisDto?> GetByRouteIdAsync(string routeId, CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .AsNoTracking()
            .Include(item => item.SourceAnalysis)
            .Include(item => item.Transcodes)
                .ThenInclude(transcode => transcode.Analysis)
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return null;
        }

        var tree = video.SourceAnalysis != null
            ? AnalysisTreeNormalizer.Normalize(DeserializeTree(video.SourceAnalysis.TreeJson))
            : new AnalysisTreeDocument();
        var series = video.SourceAnalysis != null
            ? DeserializeSeries(video.SourceAnalysis.SeriesJson) ?? new AnalysisSeriesDocument()
            : new AnalysisSeriesDocument();

        var targets = new List<AnalysisTarget> {
            AnalysisTargetBuilder.BuildSourceTarget(tree, series)
        };

        DateTime? latestUpdate = video.SourceAnalysis?.UpdatedAtUtc;

        foreach (var transcode in video.Transcodes.OrderBy(item => item.CreatedAtUtc)) {
            AnalysisTreeDocument? transcodeTree = null;
            AnalysisSeriesDocument? transcodeSeries = null;

            if (transcode.Analysis != null) {
                transcodeTree = AnalysisTreeNormalizer.Normalize(DeserializeTree(transcode.Analysis.TreeJson));
                transcodeSeries = DeserializeSeries(transcode.Analysis.SeriesJson) ?? new AnalysisSeriesDocument();
                if (latestUpdate == null || transcode.Analysis.UpdatedAtUtc > latestUpdate) {
                    latestUpdate = transcode.Analysis.UpdatedAtUtc;
                }
            }

            targets.Add(AnalysisTargetBuilder.BuildTranscodeTarget(
                transcode,
                video.ActiveTranscodeId == transcode.Id,
                transcodeTree,
                transcodeSeries));
        }

        return new VideoAnalysisDto {
            RouteId = routeId,
            SchemaVersion = 2,
            UpdatedAtUtc = latestUpdate,
            Targets = targets,
            FutureTests = AnalysisTargetBuilder.BuildFutureTests()
        };
    }

    private static string SerializeTree(AnalysisTreeDocument tree) {
        return JsonSerializer.Serialize(tree, JsonOptions);
    }

    private static AnalysisTreeDocument DeserializeTree(string json) {
        if (string.IsNullOrWhiteSpace(json)) {
            return new AnalysisTreeDocument();
        }

        return JsonSerializer.Deserialize<AnalysisTreeDocument>(json, JsonOptions) ?? new AnalysisTreeDocument();
    }

    private static string SerializeSeries(AnalysisSeriesDocument series) {
        return JsonSerializer.Serialize(series, JsonOptions);
    }

    private static AnalysisSeriesDocument? DeserializeSeries(string? json) {
        if (string.IsNullOrWhiteSpace(json)) {
            return new AnalysisSeriesDocument();
        }

        return JsonSerializer.Deserialize<AnalysisSeriesDocument>(json, JsonOptions);
    }
}
