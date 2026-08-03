using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;

namespace WebWVideoStreamingAPI.Infrastructure.Analysis;

public interface IVideoTranscodeAnalysisService {
    Task<VideoTranscodeAnalysis> GetOrCreateAsync(Guid transcodeId, CancellationToken cancellationToken = default);
    Task MarkSectionRunningAsync(Guid transcodeId, string sectionId, string label, string source, CancellationToken cancellationToken = default);
    Task UpsertSectionAsync(Guid transcodeId, AnalysisTreeNode section, CancellationToken cancellationToken = default);
    Task SetSeriesAsync(Guid transcodeId, AnalysisSeriesDocument series, CancellationToken cancellationToken = default);
    Task MarkSectionFailedAsync(Guid transcodeId, string sectionId, string label, string source, string error, CancellationToken cancellationToken = default);
    Task<(AnalysisTreeDocument Tree, AnalysisSeriesDocument Series)?> TryGetDocumentsAsync(Guid transcodeId, CancellationToken cancellationToken = default);
}

public class VideoTranscodeAnalysisService : IVideoTranscodeAnalysisService {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly AppDbContext _dbContext;

    public VideoTranscodeAnalysisService(AppDbContext dbContext) {
        _dbContext = dbContext;
    }

    public async Task<VideoTranscodeAnalysis> GetOrCreateAsync(
        Guid transcodeId,
        CancellationToken cancellationToken = default) {
        var existing = await _dbContext.VideoTranscodeAnalyses
            .FirstOrDefaultAsync(analysis => analysis.TranscodeId == transcodeId, cancellationToken);

        if (existing != null) {
            return existing;
        }

        var report = new VideoTranscodeAnalysis {
            TranscodeId = transcodeId,
            SchemaVersion = 2,
            TreeJson = SerializeTree(new AnalysisTreeDocument {
                Id = $"transcode-{transcodeId:N}",
                Label = "Transcode analysis"
            }),
            SeriesJson = SerializeSeries(new AnalysisSeriesDocument()),
            UpdatedAtUtc = DateTime.UtcNow
        };

        _dbContext.VideoTranscodeAnalyses.Add(report);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return report;
    }

    public async Task MarkSectionRunningAsync(
        Guid transcodeId,
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

        await UpsertSectionAsync(transcodeId, section, cancellationToken);
    }

    public async Task UpsertSectionAsync(
        Guid transcodeId,
        AnalysisTreeNode section,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(transcodeId, cancellationToken);
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

    public async Task SetSeriesAsync(
        Guid transcodeId,
        AnalysisSeriesDocument series,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(transcodeId, cancellationToken);
        report.SeriesJson = SerializeSeries(series);
        report.SchemaVersion = 2;
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkSectionFailedAsync(
        Guid transcodeId,
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

        await UpsertSectionAsync(transcodeId, section, cancellationToken);
    }

    public async Task<(AnalysisTreeDocument Tree, AnalysisSeriesDocument Series)?> TryGetDocumentsAsync(
        Guid transcodeId,
        CancellationToken cancellationToken = default) {
        var report = await _dbContext.VideoTranscodeAnalyses
            .AsNoTracking()
            .FirstOrDefaultAsync(analysis => analysis.TranscodeId == transcodeId, cancellationToken);

        if (report == null) {
            return null;
        }

        return (
            AnalysisTreeNormalizer.Normalize(DeserializeTree(report.TreeJson)),
            DeserializeSeries(report.SeriesJson) ?? new AnalysisSeriesDocument()
        );
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
