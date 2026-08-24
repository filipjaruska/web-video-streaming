using System.Globalization;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Compares every derived ladder against the static one using the bitrates and VMAF scores actually
/// measured on their packaged renditions, and reports the BD-rate between them.
/// </summary>
/// <remarks>
/// This is the verification step: everything before it predicts what a ladder should achieve from
/// CRF samples, and this measures what the shipped ladder did achieve. Every curve comes from the
/// same collector against the same source, so the only difference between them is the ladder.
/// </remarks>
public sealed class LadderComparison {
    private readonly AnalysisStore _store;
    private readonly ILogger<LadderComparison> _logger;

    public LadderComparison(AnalysisStore store, ILogger<LadderComparison> logger) {
        _store = store;
        _logger = logger;
    }

    /// <param name="candidates">Non-static ladders to score, in the order they should be reported.</param>
    public async Task<LadderComparisonDocument?> CompareAsync(
        Guid staticTranscodeId,
        IReadOnlyList<(LadderKind Kind, Guid TranscodeId)> candidates,
        CancellationToken cancellationToken = default) {
        try {
            var document = new LadderComparisonDocument {
                StaticPoints = await LoadPointsAsync(staticTranscodeId, cancellationToken)
            };

            foreach (var (kind, transcodeId) in candidates) {
                var points = await LoadPointsAsync(transcodeId, cancellationToken);
                document.Ladders.Add(BuildEntry(kind, document.StaticPoints, points));
            }

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { LadderComparison = document },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(document),
                cancellationToken);

            foreach (var entry in document.Ladders) {
                if (entry.Error == null) {
                    _logger.LogInformation(
                        "{Label} BD-rate vs static: {BdRate:0.##}% over VMAF [{Low:0.#}, {High:0.#}]",
                        entry.Label,
                        entry.BdRatePercent,
                        entry.OverlapLowVmaf,
                        entry.OverlapHighVmaf);
                } else {
                    _logger.LogWarning("{Label} comparison unavailable: {Error}", entry.Label, entry.Error);
                }
            }

            return document;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Ladder comparison failed for {TranscodeId}", staticTranscodeId);
            return null;
        }
    }

    internal static LadderComparisonEntry BuildEntry(
        LadderKind kind,
        List<LadderComparisonPoint> staticPoints,
        List<LadderComparisonPoint> points) {
        var entry = new LadderComparisonEntry {
            LadderKind = AnalysisTargetBuilder.LadderToken(kind),
            Label = AnalysisTargetBuilder.LadderLabel(kind),
            Points = points
        };

        var result = BdRate.Compute(
            staticPoints.Select(ToRateQuality).ToList(),
            points.Select(ToRateQuality).ToList());

        if (!result.Success) {
            entry.Error = result.ErrorMessage;
            return entry;
        }

        entry.BdRatePercent = result.BdRatePercent;
        entry.OverlapLowVmaf = result.OverlapLowQuality;
        entry.OverlapHighVmaf = result.OverlapHighQuality;
        entry.BitrateSavingPercent = result.BitrateSavingPercent;
        entry.VmafGainAtEqualBitrate = result.QualityGainAtEqualBitrate;
        return entry;

        static RateQualityPoint ToRateQuality(LadderComparisonPoint point) =>
            new(point.BitrateBps, point.VmafHarmonicMean);
    }

    /// <summary>
    /// Reads one ladder's measured rungs. HLS is used because both packagings encode identical
    /// content and only HLS renditions are remuxed back to a file the collector can probe.
    /// </summary>
    private async Task<List<LadderComparisonPoint>> LoadPointsAsync(
        Guid transcodeId,
        CancellationToken cancellationToken) {
        var stored = await _store.TryGetAsync(AnalysisOwner.Transcode, transcodeId, cancellationToken);
        var byRendition = stored?.Series.VmafByFormat?.Hls;

        if (byRendition == null) {
            return [];
        }

        return byRendition
            .Select(entry => new LadderComparisonPoint {
                Label = entry.Key,
                BitrateBps = entry.Value.Summary.BitrateBps ?? 0,
                VmafHarmonicMean = entry.Value.Summary.HarmonicMean,
                VmafMean = entry.Value.Summary.Mean,
                Cambi = entry.Value.Summary.Cambi
            })
            .Where(point => point.BitrateBps > 0 && point.VmafHarmonicMean > 0)
            .OrderBy(point => point.BitrateBps)
            .ToList();
    }

    private static AnalysisTreeNode BuildSection(LadderComparisonDocument document) {
        var children = new List<AnalysisTreeNode>();

        foreach (var entry in document.Ladders) {
            if (entry.Error != null) {
                children.Add(Leaf($"ladderComparison.{entry.LadderKind}", entry.Label, entry.Error));
                continue;
            }

            children.Add(Leaf(
                $"ladderComparison.{entry.LadderKind}.bdRate",
                $"{entry.Label} — BD-rate vs static",
                Percent(entry.BdRatePercent)));
            children.Add(Leaf(
                $"ladderComparison.{entry.LadderKind}.overlap",
                $"{entry.Label} — measured over harmonic VMAF",
                $"{Number(entry.OverlapLowVmaf)} – {Number(entry.OverlapHighVmaf)}"));
            children.Add(Leaf(
                $"ladderComparison.{entry.LadderKind}.saving",
                $"{entry.Label} — bitrate at equal quality",
                entry.BitrateSavingPercent is { } saving ? Percent(saving) : "—"));
            children.Add(Leaf(
                $"ladderComparison.{entry.LadderKind}.gain",
                $"{entry.Label} — VMAF at equal bitrate",
                entry.VmafGainAtEqualBitrate is { } gain
                    ? gain.ToString("+0.##;-0.##;0", CultureInfo.InvariantCulture)
                    : "—"));
        }

        var anyOk = document.Ladders.Any(entry => entry.Error == null);

        return Section(
            "ladderComparison",
            "Ladder comparison (BD-rate)",
            "bd-rate",
            anyOk ? AnalysisSectionStatus.Completed : AnalysisSectionStatus.Failed,
            anyOk ? null : "No ladder could be compared against the static baseline",
            children);

        static string Percent(double value) =>
            value.ToString("+0.##;-0.##;0", CultureInfo.InvariantCulture) + " %";

        static string Number(double value) =>
            value.ToString("0.##", CultureInfo.InvariantCulture);
    }
}
