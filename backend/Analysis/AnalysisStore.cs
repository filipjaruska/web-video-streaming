using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Reads and writes analysis documents for both sources and packaging runs. One class, because the
/// two used to be copy-paste twins over identical rows.
/// </summary>
public sealed class AnalysisStore {
    private readonly AppDbContext _dbContext;

    public AnalysisStore(AppDbContext dbContext) {
        _dbContext = dbContext;
    }

    public Task MarkRunningAsync(
        AnalysisOwner owner,
        Guid id,
        string sectionId,
        string label,
        string source,
        CancellationToken cancellationToken = default) {
        return UpsertSectionAsync(
            owner,
            id,
            AnalysisNodes.Section(sectionId, label, source, AnalysisSectionStatus.Running),
            cancellationToken);
    }

    public Task MarkFailedAsync(
        AnalysisOwner owner,
        Guid id,
        string sectionId,
        string label,
        string source,
        string error,
        CancellationToken cancellationToken = default) {
        return UpsertSectionAsync(
            owner,
            id,
            AnalysisNodes.Section(sectionId, label, source, AnalysisSectionStatus.Failed, error, children: []),
            cancellationToken);
    }

    public Task UpsertSectionAsync(
        AnalysisOwner owner,
        Guid id,
        AnalysisTreeNode section,
        CancellationToken cancellationToken = default) {
        return UpsertSectionsAsync(owner, id, [section], cancellationToken);
    }

    public async Task UpsertSectionsAsync(
        AnalysisOwner owner,
        Guid id,
        IEnumerable<AnalysisTreeNode> sections,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(owner, id, cancellationToken);
        var tree = DeserializeTree(report.TreeJson);

        foreach (var section in sections) {
            var index = tree.Children.FindIndex(node => node.Id == section.Id);
            if (index >= 0) {
                tree.Children[index] = section;
            } else {
                tree.Children.Add(section);
            }
        }

        report.TreeJson = Serialize(tree);
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Merges the supplied fields into the stored series document, leaving the rest untouched.</summary>
    public async Task MergeSeriesAsync(
        AnalysisOwner owner,
        Guid id,
        AnalysisSeriesDocument patch,
        CancellationToken cancellationToken = default) {
        var report = await GetOrCreateAsync(owner, id, cancellationToken);
        var existing = DeserializeSeries(report.SeriesJson);

        report.SeriesJson = Serialize(existing.MergedWith(patch));
        report.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<(AnalysisTreeDocument Tree, AnalysisSeriesDocument Series)?> TryGetAsync(
        AnalysisOwner owner,
        Guid id,
        CancellationToken cancellationToken = default) {
        var report = await _dbContext.AnalysisReports
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Owner == owner && item.Id == id, cancellationToken);

        if (report == null) {
            return null;
        }

        return (
            AnalysisTreeNormalizer.Normalize(DeserializeTree(report.TreeJson)),
            DeserializeSeries(report.SeriesJson)
        );
    }

    /// <summary>Builds the full analysis payload: the source target plus one target per packaging run.</summary>
    public async Task<VideoAnalysisResponse?> GetByRouteIdAsync(
        string routeId,
        CancellationToken cancellationToken = default) {
        var video = await _dbContext.Videos
            .AsNoTracking()
            .Include(item => item.Transcodes)
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (video == null) {
            return null;
        }

        var transcodes = video.Transcodes.OrderBy(item => item.CreatedAtUtc).ToList();

        // One query for every report this video owns — source keyed by video id, runs by transcode id.
        var transcodeIds = transcodes.Select(item => item.Id).ToList();
        var reports = await _dbContext.AnalysisReports
            .AsNoTracking()
            .Where(report =>
                (report.Owner == AnalysisOwner.Source && report.Id == video.Id) ||
                (report.Owner == AnalysisOwner.Transcode && transcodeIds.Contains(report.Id)))
            .ToListAsync(cancellationToken);

        var sourceReport = reports.FirstOrDefault(report => report.Owner == AnalysisOwner.Source);
        var byTranscode = reports
            .Where(report => report.Owner == AnalysisOwner.Transcode)
            .ToDictionary(report => report.Id);

        var targets = new List<AnalysisTarget> {
            AnalysisTargetBuilder.BuildSourceTarget(
                sourceReport != null
                    ? AnalysisTreeNormalizer.Normalize(DeserializeTree(sourceReport.TreeJson))
                    : new AnalysisTreeDocument(),
                sourceReport != null
                    ? DeserializeSeries(sourceReport.SeriesJson)
                    : new AnalysisSeriesDocument())
        };

        var latestUpdate = sourceReport?.UpdatedAtUtc;

        foreach (var transcode in transcodes) {
            AnalysisTreeDocument? tree = null;
            AnalysisSeriesDocument? series = null;

            if (byTranscode.TryGetValue(transcode.Id, out var report)) {
                tree = AnalysisTreeNormalizer.Normalize(DeserializeTree(report.TreeJson));
                series = DeserializeSeries(report.SeriesJson);
                if (latestUpdate == null || report.UpdatedAtUtc > latestUpdate) {
                    latestUpdate = report.UpdatedAtUtc;
                }
            }

            targets.Add(AnalysisTargetBuilder.BuildTranscodeTarget(
                transcode,
                video.ActiveTranscodeId == transcode.Id,
                tree,
                series));
        }

        return new VideoAnalysisResponse {
            RouteId = routeId,
            SchemaVersion = AnalysisSchema.Version,
            UpdatedAtUtc = latestUpdate,
            Targets = targets,
            FutureTests = AnalysisTargetBuilder.BuildFutureTests()
        };
    }

    /// <summary>Removes every report owned by a video and its packaging runs.</summary>
    public Task DeleteForVideoAsync(
        Guid videoId,
        IEnumerable<Guid> transcodeIds,
        CancellationToken cancellationToken = default) =>
        DeleteForVideosAsync([videoId], transcodeIds, cancellationToken);

    /// <summary>
    /// Batch form of <see cref="DeleteForVideoAsync"/>. Reports carry no foreign key, so both
    /// delete paths call this explicitly instead of relying on a cascade.
    /// </summary>
    public async Task DeleteForVideosAsync(
        IEnumerable<Guid> videoIds,
        IEnumerable<Guid> transcodeIds,
        CancellationToken cancellationToken = default) {
        var videos = videoIds.ToList();
        var transcodes = transcodeIds.ToList();
        if (videos.Count == 0 && transcodes.Count == 0) {
            return;
        }

        await _dbContext.AnalysisReports
            .Where(report =>
                (report.Owner == AnalysisOwner.Source && videos.Contains(report.Id)) ||
                (report.Owner == AnalysisOwner.Transcode && transcodes.Contains(report.Id)))
            .ExecuteDeleteAsync(cancellationToken);
    }

    private async Task<AnalysisReport> GetOrCreateAsync(
        AnalysisOwner owner,
        Guid id,
        CancellationToken cancellationToken) {
        var existing = await _dbContext.AnalysisReports
            .FirstOrDefaultAsync(report => report.Owner == owner && report.Id == id, cancellationToken);

        if (existing != null) {
            return existing;
        }

        var report = new AnalysisReport {
            Owner = owner,
            Id = id,
            TreeJson = Serialize(NewTree(owner, id)),
            SeriesJson = Serialize(new AnalysisSeriesDocument()),
            UpdatedAtUtc = DateTime.UtcNow
        };

        _dbContext.AnalysisReports.Add(report);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return report;
    }

    private static AnalysisTreeDocument NewTree(AnalysisOwner owner, Guid id) {
        return owner == AnalysisOwner.Transcode
            ? new AnalysisTreeDocument { Id = $"transcode-{id:N}", Label = "Transcode analysis" }
            : new AnalysisTreeDocument();
    }

    private static string Serialize<T>(T document) => JsonSerializer.Serialize(document, AnalysisSchema.Json);

    private static AnalysisTreeDocument DeserializeTree(string? json) {
        if (string.IsNullOrWhiteSpace(json)) {
            return new AnalysisTreeDocument();
        }

        return JsonSerializer.Deserialize<AnalysisTreeDocument>(json, AnalysisSchema.Json)
            ?? new AnalysisTreeDocument();
    }

    private static AnalysisSeriesDocument DeserializeSeries(string? json) {
        if (string.IsNullOrWhiteSpace(json)) {
            return new AnalysisSeriesDocument();
        }

        return JsonSerializer.Deserialize<AnalysisSeriesDocument>(json, AnalysisSchema.Json)
            ?? new AnalysisSeriesDocument();
    }
}
