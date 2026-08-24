using System.Globalization;
using static WebWVideoStreamingAPI.Analysis.AnalysisNodes;

namespace WebWVideoStreamingAPI.Analysis;

/// <summary>
/// Isolates the effect of the animation encoder settings by joining the two encode grids on the
/// samples they share.
/// </summary>
/// <remarks>
/// The join is on (resolution, CRF), and both grids were measured against the same source excerpt,
/// so a matched pair differs in nothing but the encoder settings. Packaged renditions could not
/// support this comparison: the two ladders choose different bitrates by construction, so holding
/// the rung constant while varying the tune is impossible there. This is also why
/// <see cref="EncodeRecipe.Animation"/> shifts its CRF range by dropping one step and adding
/// another rather than offsetting every value — the shared values are what this joins on.
/// </remarks>
public sealed class TuningComparison {
    private readonly AnalysisStore _store;
    private readonly ILogger<TuningComparison> _logger;

    public TuningComparison(AnalysisStore store, ILogger<TuningComparison> logger) {
        _store = store;
        _logger = logger;
    }

    public async Task<TuningComparisonDocument?> CompareAsync(
        Guid staticTranscodeId,
        IReadOnlyList<EncodeGridPoint> baseGrid,
        IReadOnlyList<EncodeGridPoint> tunedGrid,
        EncodeRecipe recipe,
        CancellationToken cancellationToken = default) {
        try {
            var document = Build(baseGrid, tunedGrid, recipe);

            await _store.MergeSeriesAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                new AnalysisSeriesDocument { TuningComparison = document },
                cancellationToken);

            await _store.UpsertSectionAsync(
                AnalysisOwner.Transcode,
                staticTranscodeId,
                BuildSection(document),
                cancellationToken);

            if (document.Error == null) {
                _logger.LogInformation(
                    "Tuning comparison over {Pairs} matched samples: ΔVMAF={Vmaf:0.###}, ΔCAMBI={Cambi:0.###}, BD-rate={BdRate:0.##}%",
                    document.Pairs.Count,
                    document.MeanVmafDelta,
                    document.MeanCambiDelta,
                    document.BdRatePercent);
            } else {
                _logger.LogWarning("Tuning comparison unavailable: {Error}", document.Error);
            }

            return document;
        } catch (Exception ex) {
            _logger.LogWarning(ex, "Tuning comparison failed for {TranscodeId}", staticTranscodeId);
            return null;
        }
    }

    internal static TuningComparisonDocument Build(
        IReadOnlyList<EncodeGridPoint> baseGrid,
        IReadOnlyList<EncodeGridPoint> tunedGrid,
        EncodeRecipe recipe) {
        var document = new TuningComparisonDocument {
            Tune = recipe.Tune,
            Decimate = recipe.Decimate
        };

        var tuned = Usable(tunedGrid).ToDictionary(point => (point.Height, point.Crf));

        foreach (var basePoint in Usable(baseGrid)) {
            if (!tuned.TryGetValue((basePoint.Height, basePoint.Crf), out var tunedPoint)) {
                continue;
            }

            document.Pairs.Add(new TuningComparisonPair {
                Label = basePoint.Label,
                Height = basePoint.Height,
                Crf = basePoint.Crf,
                BaseVmaf = basePoint.VmafMean,
                TunedVmaf = tunedPoint.VmafMean,
                VmafDelta = tunedPoint.VmafMean - basePoint.VmafMean,
                BaseCambi = basePoint.Cambi,
                TunedCambi = tunedPoint.Cambi,
                BaseBitrateBps = basePoint.BitrateBps,
                TunedBitrateBps = tunedPoint.BitrateBps
            });
        }

        if (document.Pairs.Count == 0) {
            document.Error = "The two encode grids share no (resolution, CRF) samples to compare";
            return document;
        }

        document.Pairs = document.Pairs.OrderByDescending(pair => pair.Height).ThenBy(pair => pair.Crf).ToList();
        document.MeanVmafDelta = document.Pairs.Average(pair => pair.VmafDelta);

        var withCambi = document.Pairs.Where(pair => pair.BaseCambi != null && pair.TunedCambi != null).ToList();
        if (withCambi.Count > 0) {
            document.MeanCambiDelta = withCambi.Average(pair => pair.TunedCambi!.Value - pair.BaseCambi!.Value);
        }

        // BD-rate over the whole curve, so the tune is judged on rate-quality rather than on a
        // per-sample VMAF delta that ignores the bitrate it was bought at.
        var result = BdRate.Compute(
            Usable(baseGrid).Select(ToRateQuality).ToList(),
            Usable(tunedGrid).Select(ToRateQuality).ToList());

        if (result.Success) {
            document.BdRatePercent = result.BdRatePercent;
        }

        return document;

        static IEnumerable<EncodeGridPoint> Usable(IReadOnlyList<EncodeGridPoint> grid) => grid
            .Where(point => string.IsNullOrEmpty(point.Error) && point.BitrateBps > 0 && point.VmafMean > 0);

        static RateQualityPoint ToRateQuality(EncodeGridPoint point) =>
            new(point.BitrateBps, point.VmafHarmonicMean is > 0 ? point.VmafHarmonicMean.Value : point.VmafMean);
    }

    private static AnalysisTreeNode BuildSection(TuningComparisonDocument document) {
        if (document.Error != null) {
            return Section(
                "tuningComparison",
                "Codec tuning (default vs animation)",
                "tuning-comparison",
                AnalysisSectionStatus.Failed,
                document.Error,
                children: []);
        }

        var children = new List<AnalysisTreeNode> {
            Leaf("tuningComparison.settings", "Settings",
                $"-tune {document.Tune}{(document.Decimate ? " + mpdecimate" : "")}"),
            Leaf("tuningComparison.pairs", "Matched samples", document.Pairs.Count.ToString()),
            Leaf("tuningComparison.vmaf", "Mean ΔVMAF", Signed(document.MeanVmafDelta)),
            Leaf("tuningComparison.cambi", "Mean ΔCAMBI (lower is better)", Signed(document.MeanCambiDelta)),
            Leaf("tuningComparison.bdRate", "BD-rate vs default",
                document.BdRatePercent is { } bd ? Signed(bd) + " %" : "—")
        };

        return Section(
            "tuningComparison",
            "Codec tuning (default vs animation)",
            "tuning-comparison",
            AnalysisSectionStatus.Completed,
            children: children);

        static string Signed(double? value) =>
            value?.ToString("+0.###;-0.###;0", CultureInfo.InvariantCulture) ?? "—";
    }
}
