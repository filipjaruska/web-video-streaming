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
/// rarely have a rung at the same quality. BD-rate instead interpolates each curve, integrates the
/// gap between them across the overlapping quality range, and reports the mean — one number that
/// answers "same quality, how many fewer bits". Rate enters as log₁₀, where equal ratios count
/// equally.
/// <para>
/// Curves are interpolated with Akima's piecewise cubic, as recommended by Herglotz et al. (ICIP
/// 2022), not Bjøntegaard's original least-squares cubic. The single cubic does not pass through
/// the measured points and lets every rung bend the curve everywhere, so on ladders whose rungs are
/// unevenly spaced it can overshoot between them; Akima's curve passes through every point and
/// each piece depends only on its neighbours.
/// </para>
/// </remarks>
public static class BdRate {
    /// <summary>
    /// Fewer rungs than this give no curve at all. Akima needs three points; two are joined by a
    /// straight line, as the Herglotz et al. reference implementation does. The four this used to
    /// require belonged to the least-squares cubic, which needs four coefficients — keeping it would
    /// leave a ladder the floor and spacing rules cut to two or three rungs with no BD-rate at all.
    /// </summary>
    private const int MinPoints = 2;

    /// <param name="minQuality">
    /// Optional lower bound on the integration range. Both curves are still interpolated through
    /// every point; only the range the gap is averaged over is narrowed, so the lowest rungs — where
    /// a viewer would rarely be served — cannot dominate the result.
    /// </param>
    public static BdRateResult Compute(
        IReadOnlyList<RateQualityPoint> reference,
        IReadOnlyList<RateQualityPoint> test,
        double? minQuality = null) {
        var refPoints = Clean(reference);
        var testPoints = Clean(test);

        if (refPoints.Count < MinPoints || testPoints.Count < MinPoints) {
            return Fail($"BD-rate needs at least {MinPoints} valid points per ladder");
        }

        var low = Math.Max(refPoints[0].Quality, testPoints[0].Quality);
        if (minQuality is { } floor) {
            low = Math.Max(low, floor);
        }

        var high = Math.Min(refPoints[^1].Quality, testPoints[^1].Quality);

        if (high - low < 1e-6) {
            return Fail("The two ladders share no overlapping quality range");
        }

        // log₁₀(rate) as a function of quality.
        var refCurve = AkimaCurve.Fit(refPoints.Select(p => p.Quality), refPoints.Select(p => Math.Log10(p.BitrateBps)));
        var testCurve = AkimaCurve.Fit(testPoints.Select(p => p.Quality), testPoints.Select(p => Math.Log10(p.BitrateBps)));

        if (refCurve == null || testCurve == null) {
            return Fail("Rate-quality curve interpolation failed (degenerate points)");
        }

        var meanDiff = (testCurve.Integrate(low, high) - refCurve.Integrate(low, high)) / (high - low);
        var midQuality = (low + high) / 2;

        return new BdRateResult {
            Success = true,
            BdRatePercent = (Math.Pow(10, meanDiff) - 1) * 100,
            OverlapLowQuality = low,
            OverlapHighQuality = high,
            BitrateSavingPercent =
                (Math.Pow(10, testCurve.Evaluate(midQuality) - refCurve.Evaluate(midQuality)) - 1) * 100,
            QualityGainAtEqualBitrate = QualityGain(reference, test)
        };
    }

    /// <summary>Quality difference at equal bitrate, interpolating quality over log₁₀(rate).</summary>
    private static double? QualityGain(
        IReadOnlyList<RateQualityPoint> reference,
        IReadOnlyList<RateQualityPoint> test) {
        var refByRate = CleanByRate(reference);
        var testByRate = CleanByRate(test);

        if (refByRate.Count < MinPoints || testByRate.Count < MinPoints) {
            return null;
        }

        var low = Math.Max(Math.Log10(refByRate[0].BitrateBps), Math.Log10(testByRate[0].BitrateBps));
        var high = Math.Min(Math.Log10(refByRate[^1].BitrateBps), Math.Log10(testByRate[^1].BitrateBps));

        if (high - low < 1e-6) {
            return null;
        }

        var refCurve = AkimaCurve.Fit(refByRate.Select(p => Math.Log10(p.BitrateBps)), refByRate.Select(p => p.Quality));
        var testCurve = AkimaCurve.Fit(testByRate.Select(p => Math.Log10(p.BitrateBps)), testByRate.Select(p => p.Quality));

        if (refCurve == null || testCurve == null) {
            return null;
        }

        var mid = (low + high) / 2;
        return testCurve.Evaluate(mid) - refCurve.Evaluate(mid);
    }

    /// <summary>
    /// Drops unusable points and collapses duplicate qualities, which an interpolant through every
    /// point cannot pass through twice.
    /// </summary>
    private static List<RateQualityPoint> Clean(IReadOnlyList<RateQualityPoint> points) {
        return points
            .Where(point => point.BitrateBps > 0 && point.Quality > 0)
            .GroupBy(point => Math.Round(point.Quality, 6))
            .Select(group => new RateQualityPoint(group.Average(point => point.BitrateBps), group.Average(point => point.Quality)))
            .OrderBy(point => point.Quality)
            .ToList();
    }

    /// <summary>As <see cref="Clean"/>, but keyed on bitrate for curves interpolated over rate.</summary>
    private static List<RateQualityPoint> CleanByRate(IReadOnlyList<RateQualityPoint> points) {
        return points
            .Where(point => point.BitrateBps > 0 && point.Quality > 0)
            .GroupBy(point => Math.Round(point.BitrateBps, 3))
            .Select(group => new RateQualityPoint(group.Average(point => point.BitrateBps), group.Average(point => point.Quality)))
            .OrderBy(point => point.BitrateBps)
            .ToList();
    }

    private static BdRateResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };

    /// <summary>
    /// Akima (1970) interpolation: a cubic Hermite piece per interval, with the slope at each point
    /// a weighted mean of the neighbouring secants. The end handling and the degenerate-weight
    /// fallback follow SciPy's <c>Akima1DInterpolator</c>, which the Herglotz et al. reference
    /// implementation uses, so results match it.
    /// </summary>
    private sealed class AkimaCurve {
        private readonly double[] _x;
        private readonly double[] _y;
        private readonly double[] _slope;
        private readonly double[] _c2;
        private readonly double[] _c3;

        private AkimaCurve(double[] x, double[] y, double[] slope, double[] c2, double[] c3) {
            _x = x;
            _y = y;
            _slope = slope;
            _c2 = c2;
            _c3 = c3;
        }

        /// <summary>
        /// Interpolates through (x, y) with x strictly increasing; null when it is not. Two points
        /// are joined by a straight line, which is what Akima's rule cannot be applied to.
        /// </summary>
        public static AkimaCurve? Fit(IEnumerable<double> xs, IEnumerable<double> ys) {
            var x = xs.ToArray();
            var y = ys.ToArray();
            var n = x.Length;
            if (n < 2 || y.Length != n) {
                return null;
            }

            if (n == 2) {
                var h = x[1] - x[0];
                if (h <= 0) {
                    return null;
                }

                var secant = (y[1] - y[0]) / h;
                return new AkimaCurve(x, y, [secant, secant], [0], [0]);
            }

            // Secants m[2..n], padded with two linearly extrapolated secants at each end.
            var m = new double[n + 3];
            for (var i = 0; i < n - 1; i++) {
                var h = x[i + 1] - x[i];
                if (h <= 0) {
                    return null;
                }

                m[i + 2] = (y[i + 1] - y[i]) / h;
            }

            m[1] = 2 * m[2] - m[3];
            m[0] = 2 * m[1] - m[2];
            m[n + 1] = 2 * m[n] - m[n - 1];
            m[n + 2] = 2 * m[n + 1] - m[n];

            // Each point's slope leans towards the side where the secants change least.
            var right = new double[n];
            var left = new double[n];
            var maxWeight = 0.0;
            for (var i = 0; i < n; i++) {
                right[i] = Math.Abs(m[i + 3] - m[i + 2]);
                left[i] = Math.Abs(m[i + 1] - m[i]);
                maxWeight = Math.Max(maxWeight, right[i] + left[i]);
            }

            var slope = new double[n];
            for (var i = 0; i < n; i++) {
                var weight = right[i] + left[i];
                slope[i] = weight > 1e-9 * maxWeight
                    ? (right[i] * m[i + 1] + left[i] * m[i + 2]) / weight
                    : (m[i + 3] + m[i]) / 2;
            }

            var c2 = new double[n - 1];
            var c3 = new double[n - 1];
            for (var i = 0; i < n - 1; i++) {
                var h = x[i + 1] - x[i];
                var secant = m[i + 2];
                c2[i] = (3 * secant - 2 * slope[i] - slope[i + 1]) / h;
                c3[i] = (slope[i] + slope[i + 1] - 2 * secant) / (h * h);
            }

            return new AkimaCurve(x, y, slope, c2, c3);
        }

        public double Evaluate(double x) {
            var i = Interval(x);
            var u = x - _x[i];
            return _y[i] + u * (_slope[i] + u * (_c2[i] + u * _c3[i]));
        }

        /// <summary>Exact integral of the piecewise cubic between two bounds inside the sampled range.</summary>
        public double Integrate(double low, double high) {
            double sum = 0;
            for (var i = 0; i < _x.Length - 1; i++) {
                var from = Math.Max(low, _x[i]);
                var to = Math.Min(high, _x[i + 1]);
                if (to > from) {
                    sum += Antiderivative(i, to - _x[i]) - Antiderivative(i, from - _x[i]);
                }
            }

            return sum;
        }

        private double Antiderivative(int i, double u) =>
            u * (_y[i] + u * (_slope[i] / 2 + u * (_c2[i] / 3 + u * _c3[i] / 4)));

        private int Interval(double x) {
            var i = Array.BinarySearch(_x, x);
            if (i < 0) {
                i = ~i - 1;
            }

            return Math.Clamp(i, 0, _x.Length - 2);
        }
    }
}
