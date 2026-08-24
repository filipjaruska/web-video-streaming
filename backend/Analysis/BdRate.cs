namespace WebWVideoStreamingAPI.Analysis;

/// <summary>A measured rate-quality point on one ladder.</summary>
public readonly record struct RateQualityPoint(double BitrateBps, double Quality);

public sealed class BdRateResult {
    public bool Success { get; init; }
    public string? ErrorMessage { get; init; }

    /// <summary>
    /// Average bitrate difference of the test curve against the reference at equal quality, in
    /// percent. Negative means the test ladder delivers the same quality for fewer bits.
    /// </summary>
    public double BdRatePercent { get; init; }

    public double OverlapLowQuality { get; init; }
    public double OverlapHighQuality { get; init; }

    /// <summary>Bitrate difference at the midpoint of the overlapping quality range, in percent.</summary>
    public double? BitrateSavingPercent { get; init; }

    /// <summary>Quality difference at the midpoint of the overlapping bitrate range.</summary>
    public double? QualityGainAtEqualBitrate { get; init; }
}

/// <summary>
/// Bjøntegaard delta rate: the average bitrate difference between two rate-quality curves over the
/// quality range they share.
/// </summary>
/// <remarks>
/// Comparing two ladders at a single operating point says almost nothing, because the two ladders
/// rarely have a rung at the same quality. BD-rate instead fits each curve, integrates the gap
/// between them across the overlapping quality range, and reports the mean — one number that
/// answers "same quality, how many fewer bits". Rate enters as log₁₀, which is the domain where
/// rate-quality curves are close to polynomial and where equal ratios count equally.
/// </remarks>
public static class BdRate {
    /// <summary>A cubic fit needs four points; a ladder rung count below that cannot be compared.</summary>
    private const int MinPoints = 4;

    public static BdRateResult Compute(
        IReadOnlyList<RateQualityPoint> reference,
        IReadOnlyList<RateQualityPoint> test) {
        var refPoints = Clean(reference);
        var testPoints = Clean(test);

        if (refPoints.Count < MinPoints || testPoints.Count < MinPoints) {
            return Fail($"BD-rate needs at least {MinPoints} valid points per ladder");
        }

        var low = Math.Max(refPoints[0].Quality, testPoints[0].Quality);
        var high = Math.Min(refPoints[^1].Quality, testPoints[^1].Quality);

        if (high - low < 1e-6) {
            return Fail("The two ladders share no overlapping quality range");
        }

        // log₁₀(rate) as a cubic in quality, per Bjøntegaard's original formulation.
        var refFit = PolyFit3(refPoints.Select(p => p.Quality), refPoints.Select(p => Math.Log10(p.BitrateBps)));
        var testFit = PolyFit3(testPoints.Select(p => p.Quality), testPoints.Select(p => Math.Log10(p.BitrateBps)));

        if (refFit == null || testFit == null) {
            return Fail("Rate-quality curve fit failed (degenerate points)");
        }

        var meanDiff = (Integrate(testFit, low, high) - Integrate(refFit, low, high)) / (high - low);
        var midQuality = (low + high) / 2;

        return new BdRateResult {
            Success = true,
            BdRatePercent = (Math.Pow(10, meanDiff) - 1) * 100,
            OverlapLowQuality = low,
            OverlapHighQuality = high,
            BitrateSavingPercent =
                (Math.Pow(10, Evaluate(testFit, midQuality) - Evaluate(refFit, midQuality)) - 1) * 100,
            QualityGainAtEqualBitrate = QualityGain(refPoints, testPoints)
        };
    }

    /// <summary>Quality difference at equal bitrate, fitting quality as a cubic in log₁₀(rate).</summary>
    private static double? QualityGain(
        IReadOnlyList<RateQualityPoint> reference,
        IReadOnlyList<RateQualityPoint> test) {
        var refByRate = reference.OrderBy(point => point.BitrateBps).ToList();
        var testByRate = test.OrderBy(point => point.BitrateBps).ToList();

        var low = Math.Max(Math.Log10(refByRate[0].BitrateBps), Math.Log10(testByRate[0].BitrateBps));
        var high = Math.Min(Math.Log10(refByRate[^1].BitrateBps), Math.Log10(testByRate[^1].BitrateBps));

        if (high - low < 1e-6) {
            return null;
        }

        var refFit = PolyFit3(refByRate.Select(p => Math.Log10(p.BitrateBps)), refByRate.Select(p => p.Quality));
        var testFit = PolyFit3(testByRate.Select(p => Math.Log10(p.BitrateBps)), testByRate.Select(p => p.Quality));

        if (refFit == null || testFit == null) {
            return null;
        }

        var mid = (low + high) / 2;
        return Evaluate(testFit, mid) - Evaluate(refFit, mid);
    }

    /// <summary>
    /// Drops unusable points and collapses duplicate x values, which would make the fit singular.
    /// </summary>
    private static List<RateQualityPoint> Clean(IReadOnlyList<RateQualityPoint> points) {
        return points
            .Where(point => point.BitrateBps > 0 && point.Quality > 0)
            .GroupBy(point => Math.Round(point.Quality, 6))
            .Select(group => new RateQualityPoint(group.Average(point => point.BitrateBps), group.Key))
            .OrderBy(point => point.Quality)
            .ToList();
    }

    /// <summary>Least-squares cubic y = c₀ + c₁x + c₂x² + c₃x³, solved through the normal equations.</summary>
    private static double[]? PolyFit3(IEnumerable<double> xs, IEnumerable<double> ys) {
        var x = xs.ToArray();
        var y = ys.ToArray();
        const int terms = 4;

        // Normal equations: (AᵀA)c = Aᵀy, where A's columns are 1, x, x², x³.
        var matrix = new double[terms, terms + 1];

        for (var row = 0; row < terms; row++) {
            for (var col = 0; col < terms; col++) {
                double sum = 0;
                for (var i = 0; i < x.Length; i++) {
                    sum += Math.Pow(x[i], row + col);
                }

                matrix[row, col] = sum;
            }

            double rhs = 0;
            for (var i = 0; i < x.Length; i++) {
                rhs += y[i] * Math.Pow(x[i], row);
            }

            matrix[row, terms] = rhs;
        }

        return SolveGaussian(matrix, terms);
    }

    private static double[]? SolveGaussian(double[,] matrix, int size) {
        for (var pivot = 0; pivot < size; pivot++) {
            var best = pivot;
            for (var row = pivot + 1; row < size; row++) {
                if (Math.Abs(matrix[row, pivot]) > Math.Abs(matrix[best, pivot])) {
                    best = row;
                }
            }

            if (Math.Abs(matrix[best, pivot]) < 1e-12) {
                return null;
            }

            if (best != pivot) {
                for (var col = 0; col <= size; col++) {
                    (matrix[pivot, col], matrix[best, col]) = (matrix[best, col], matrix[pivot, col]);
                }
            }

            for (var row = 0; row < size; row++) {
                if (row == pivot) {
                    continue;
                }

                var factor = matrix[row, pivot] / matrix[pivot, pivot];
                for (var col = pivot; col <= size; col++) {
                    matrix[row, col] -= factor * matrix[pivot, col];
                }
            }
        }

        var solution = new double[size];
        for (var i = 0; i < size; i++) {
            solution[i] = matrix[i, size] / matrix[i, i];
        }

        return solution;
    }

    private static double Evaluate(double[] coefficients, double x) =>
        coefficients[0] + coefficients[1] * x + coefficients[2] * x * x + coefficients[3] * x * x * x;

    /// <summary>Definite integral of the cubic between two bounds, evaluated analytically.</summary>
    private static double Integrate(double[] c, double low, double high) {
        return Antiderivative(high) - Antiderivative(low);

        double Antiderivative(double x) =>
            c[0] * x +
            c[1] * x * x / 2 +
            c[2] * x * x * x / 3 +
            c[3] * x * x * x * x / 4;
    }

    private static BdRateResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}
