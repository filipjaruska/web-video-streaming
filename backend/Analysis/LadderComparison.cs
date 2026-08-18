using System.Globalization;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Compares the derived ladder against the static one using the bitrates and VMAF scores actually
/// measured on their packaged renditions, and reports the BD-rate between them.
/// </summary>
/// <remarks>
/// This is the verification step: everything before it predicts what a ladder should achieve from
/// CRF samples, and this measures what the shipped ladder did achieve. Both curves come from the
/// same collector against the same source, so the only difference between them is the ladder.
/// </remarks>
public sealed class LadderComparison {
    private readonly AnalysisStore _store;
    private readonly ILogger<LadderComparison> _logger;

    public LadderComparison(AnalysisStore store, ILogger<LadderComparison> logger) {
        _store = store;
        _logger = logger;
    }

    public async Task<LadderComparisonDocument?> CompareAsync(
        Guid staticTranscodeId,
        Guid dynamicTranscodeId,
        CancellationToken cancellationToken = default) {
        try {
            var staticPoints = await LoadPointsAsync(staticTranscodeId, cancellationToken);
            var dynamicPoints = await LoadPointsAsync(dynamicTranscodeId, cancellationToken);

            var document = Build(staticPoints, dynamicPoints);

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

            if (document.Error == null) {
                _logger.LogInformation(
                    "Dynamic ladder BD-rate vs static: {BdRate:0.##}% over VMAF [{Low:0.#}, {High:0.#}]",
                    document.BdRatePercent,
                    document.OverlapLowVmaf,
                    document.OverlapHighVmaf);
            } else {
                _logger.LogWarning("Ladder comparison unavailable: {Error}", document.Error);
            }

            return document;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Ladder comparison failed for {TranscodeId}", staticTranscodeId);
            return null;
        }
    }

    internal static LadderComparisonDocument Build(
        List<LadderComparisonPoint> staticPoints,
        List<LadderComparisonPoint> dynamicPoints) {
        var document = new LadderComparisonDocument {
            StaticPoints = staticPoints,
            DynamicPoints = dynamicPoints
        };

        var result = BdRate.Compute(
            staticPoints.Select(ToRateQuality).ToList(),
            dynamicPoints.Select(ToRateQuality).ToList());

        if (!result.Success) {
            document.Error = result.ErrorMessage;
            return document;
        }

        document.BdRatePercent = result.BdRatePercent;
        document.OverlapLowVmaf = result.OverlapLowQuality;
        document.OverlapHighVmaf = result.OverlapHighQuality;
        document.BitrateSavingPercent = result.BitrateSavingPercent;
        document.VmafGainAtEqualBitrate = result.QualityGainAtEqualBitrate;
        return document;

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
                VmafMean = entry.Value.Summary.Mean
            })
            .Where(point => point.BitrateBps > 0 && point.VmafHarmonicMean > 0)
            .OrderBy(point => point.BitrateBps)
            .ToList();
    }

    private static AnalysisTreeNode BuildSection(LadderComparisonDocument document) {
        if (document.Error != null) {
            return Section(
                "ladderComparison",
                "Ladder comparison (BD-rate)",
                "bd-rate",
                AnalysisSectionStatus.Failed,
                document.Error,
                children: []);
        }

        return Section(
            "ladderComparison",
            "Ladder comparison (BD-rate)",
            "bd-rate",
            AnalysisSectionStatus.Completed,
            children: [
                Leaf("ladderComparison.bdRate", "BD-rate vs static ladder", Percent(document.BdRatePercent)),
                Leaf(
                    "ladderComparison.overlap",
                    "Measured over harmonic VMAF",
                    $"{Number(document.OverlapLowVmaf)} – {Number(document.OverlapHighVmaf)}"),
                Leaf(
                    "ladderComparison.saving",
                    "Bitrate at equal quality",
                    document.BitrateSavingPercent is { } saving ? Percent(saving) : "—"),
                Leaf(
                    "ladderComparison.gain",
                    "VMAF at equal bitrate",
                    document.VmafGainAtEqualBitrate is { } gain ? gain.ToString("+0.##;-0.##;0", CultureInfo.InvariantCulture) : "—")
            ]);

        static string Percent(double value) =>
            value.ToString("+0.##;-0.##;0", CultureInfo.InvariantCulture) + " %";

        static string Number(double value) =>
            value.ToString("0.##", CultureInfo.InvariantCulture);
    }
}
