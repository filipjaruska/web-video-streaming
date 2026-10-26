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

    /// <summary>
    /// Average quality difference at equal bitrate over the whole overlapping log-rate range
    /// (Bjøntegaard delta quality). Positive means the test ladder delivers more quality per bit.
    /// </summary>
    public double? BdQuality { get; init; }

    /// <summary>
    /// How the curves behind <see cref="BdRatePercent"/> and <see cref="BitrateSavingPercent"/> were
    /// interpolated; one of <see cref="BdRateInterpolation"/>.
    /// </summary>
    public string? Interpolation { get; init; }

    /// <summary>How the curves behind <see cref="QualityGainAtEqualBitrate"/> were interpolated.</summary>
    public string? QualityGainInterpolation { get; init; }
}

/// <summary>The interpolation reported next to each value.</summary>
public static class BdRateInterpolation {
    public const string Akima = "akima";

    /// <summary>Akima's curve was not monotone over the integration range on one of the two ladders.</summary>
    public const string Pchip = "pchip";

    /// <summary>Both ladders had two points, which every method joins with a straight line.</summary>
    public const string Linear = "linear";
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
/// <para>
/// Akima still does not preserve monotonicity: where a ladder's rungs crowd together in quality
/// beside a long step, a piece can dip, and a rate that falls as quality rises is no ladder at all.
/// Such a dip inside the integration range is integrated as if it were measured. When either curve
/// is not monotone over that range both are refit with PCHIP (Fritsch–Carlson), which is monotone
/// wherever the points are, and the value says so.
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
        var curves = FitPair(
            refPoints.Select(p => p.Quality), refPoints.Select(p => Math.Log10(p.BitrateBps)),
            testPoints.Select(p => p.Quality), testPoints.Select(p => Math.Log10(p.BitrateBps)),
            low,
            high);

        if (curves == null) {
            return Fail("Rate-quality curve interpolation failed (degenerate points)");
        }

        var (refCurve, testCurve, method) = curves.Value;
        var meanDiff = (testCurve.Integrate(low, high) - refCurve.Integrate(low, high)) / (high - low);
        var midQuality = (low + high) / 2;
        var gain = QualityGain(reference, test);

        return new BdRateResult {
            Success = true,
            BdRatePercent = (Math.Pow(10, meanDiff) - 1) * 100,
            OverlapLowQuality = low,
            OverlapHighQuality = high,
            BitrateSavingPercent =
                (Math.Pow(10, testCurve.Evaluate(midQuality) - refCurve.Evaluate(midQuality)) - 1) * 100,
            Interpolation = method,
            QualityGainAtEqualBitrate = gain?.Value,
            BdQuality = gain?.BdQuality,
            QualityGainInterpolation = gain?.Method
        };
    }

    /// <summary>
    /// Quality difference at equal bitrate, interpolating quality over log₁₀(rate): at the midpoint
    /// of the shared rate range, and averaged over all of it (BD-quality, e.g. BD-VMAF).
    /// </summary>
    private static (double Value, double BdQuality, string Method)? QualityGain(
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

        var curves = FitPair(
            refByRate.Select(p => Math.Log10(p.BitrateBps)), refByRate.Select(p => p.Quality),
            testByRate.Select(p => Math.Log10(p.BitrateBps)), testByRate.Select(p => p.Quality),
            low,
            high);

        if (curves == null) {
            return null;
        }

        var (refCurve, testCurve, method) = curves.Value;
        var mid = (low + high) / 2;
        var bdQuality = (testCurve.Integrate(low, high) - refCurve.Integrate(low, high)) / (high - low);
        return (testCurve.Evaluate(mid) - refCurve.Evaluate(mid), bdQuality, method);
    }

    /// <summary>
    /// Both curves by Akima, or both by PCHIP when Akima's is not monotone over [low, high] on
    /// either: the two sides of a difference are interpolated the same way.
    /// </summary>
    private static (HermiteCurve Reference, HermiteCurve Test, string Method)? FitPair(
        IEnumerable<double> refX, IEnumerable<double> refY,
        IEnumerable<double> testX, IEnumerable<double> testY,
        double low,
        double high) {
        var rx = refX.ToArray();
        var ry = refY.ToArray();
        var tx = testX.ToArray();
        var ty = testY.ToArray();

        var refAkima = HermiteCurve.Akima(rx, ry);
        var testAkima = HermiteCurve.Akima(tx, ty);
        if (refAkima == null || testAkima == null) {
            return null;
        }

        if (rx.Length == 2 && tx.Length == 2) {
            return (refAkima, testAkima, BdRateInterpolation.Linear);
        }

        if (refAkima.IsIncreasingOver(low, high) && testAkima.IsIncreasingOver(low, high)) {
            return (refAkima, testAkima, BdRateInterpolation.Akima);
        }

        var refPchip = HermiteCurve.Pchip(rx, ry);
        var testPchip = HermiteCurve.Pchip(tx, ty);
        return refPchip == null || testPchip == null
            ? null
            : (refPchip, testPchip, BdRateInterpolation.Pchip);
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
    /// A piecewise cubic Hermite curve through every point: one cubic per interval, fixed by the
    /// values and the slopes at its two ends. Akima and PCHIP differ only in how the slopes are
    /// chosen. Both follow SciPy (<c>Akima1DInterpolator</c>, <c>PchipInterpolator</c>), which the
    /// Herglotz et al. reference implementation uses, so results match it.
    /// </summary>
    private sealed class HermiteCurve {
        private readonly double[] _x;
        private readonly double[] _y;
        private readonly double[] _slope;
        private readonly double[] _c2;
        private readonly double[] _c3;

        private HermiteCurve(double[] x, double[] y, double[] slope) {
            _x = x;
            _y = y;
            _slope = slope;
            _c2 = new double[x.Length - 1];
            _c3 = new double[x.Length - 1];
            for (var i = 0; i < x.Length - 1; i++) {
                var h = x[i + 1] - x[i];
                var secant = (y[i + 1] - y[i]) / h;
                _c2[i] = (3 * secant - 2 * slope[i] - slope[i + 1]) / h;
                _c3[i] = (slope[i] + slope[i + 1] - 2 * secant) / (h * h);
            }
        }

        /// <summary>
        /// Akima (1970): the slope at each point a weighted mean of the neighbouring secants. Null
        /// unless x is strictly increasing. Two points are joined by a straight line, which is what
        /// Akima's rule cannot be applied to.
        /// </summary>
        public static HermiteCurve? Akima(double[] x, double[] y) {
            var m = Secants(x, y);
            if (m == null) {
                return null;
            }

            var n = x.Length;
            if (n == 2) {
                return new HermiteCurve(x, y, [m[0], m[0]]);
            }

            // Padded with two linearly extrapolated secants at each end.
            var padded = new double[n + 3];
            Array.Copy(m, 0, padded, 2, n - 1);
            padded[1] = 2 * padded[2] - padded[3];
            padded[0] = 2 * padded[1] - padded[2];
            padded[n + 1] = 2 * padded[n] - padded[n - 1];
            padded[n + 2] = 2 * padded[n + 1] - padded[n];

            // Each point's slope leans towards the side where the secants change least.
            var right = new double[n];
            var left = new double[n];
            var maxWeight = 0.0;
            for (var i = 0; i < n; i++) {
                right[i] = Math.Abs(padded[i + 3] - padded[i + 2]);
                left[i] = Math.Abs(padded[i + 1] - padded[i]);
                maxWeight = Math.Max(maxWeight, right[i] + left[i]);
            }

            var slope = new double[n];
            for (var i = 0; i < n; i++) {
                var weight = right[i] + left[i];
                slope[i] = weight > 1e-9 * maxWeight
                    ? (right[i] * padded[i + 1] + left[i] * padded[i + 2]) / weight
                    : (padded[i + 3] + padded[i]) / 2;
            }

            return new HermiteCurve(x, y, slope);
        }

        /// <summary>
        /// PCHIP (Fritsch–Carlson): a zero slope where the secants change sign, otherwise their
        /// weighted harmonic mean, which keeps every piece within the monotonicity of its points.
        /// </summary>
        public static HermiteCurve? Pchip(double[] x, double[] y) {
            var m = Secants(x, y);
            if (m == null) {
                return null;
            }

            var n = x.Length;
            if (n == 2) {
                return new HermiteCurve(x, y, [m[0], m[0]]);
            }

            var slope = new double[n];
            for (var i = 1; i < n - 1; i++) {
                if (m[i - 1] * m[i] <= 0) {
                    continue;
                }

                var hPrev = x[i] - x[i - 1];
                var hNext = x[i + 1] - x[i];
                var w1 = 2 * hNext + hPrev;
                var w2 = hNext + 2 * hPrev;
                slope[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
            }

            slope[0] = EndSlope(x[1] - x[0], x[2] - x[1], m[0], m[1]);
            slope[n - 1] = EndSlope(x[n - 1] - x[n - 2], x[n - 2] - x[n - 3], m[n - 2], m[n - 3]);
            return new HermiteCurve(x, y, slope);

            // A one-sided three-point estimate, held to the sign of its own secant and to at most
            // three times it where the secants turn — SciPy's edge case.
            static double EndSlope(double h0, double h1, double m0, double m1) {
                var d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
                if (Math.Sign(d) != Math.Sign(m0)) {
                    return 0;
                }

                if (Math.Sign(m0) != Math.Sign(m1) && Math.Abs(d) > 3 * Math.Abs(m0)) {
                    return 3 * m0;
                }

                return d;
            }
        }

        /// <summary>Secants between consecutive points; null unless x is strictly increasing.</summary>
        private static double[]? Secants(double[] x, double[] y) {
            var n = x.Length;
            if (n < 2 || y.Length != n) {
                return null;
            }

            var m = new double[n - 1];
            for (var i = 0; i < n - 1; i++) {
                var h = x[i + 1] - x[i];
                if (h <= 0) {
                    return null;
                }

                m[i] = (y[i + 1] - y[i]) / h;
            }

            return m;
        }

        /// <summary>
        /// Whether the curve never falls between two bounds: its derivative, a quadratic per piece,
        /// is checked at both ends of each piece's part of the range and at its turning point.
        /// </summary>
        public bool IsIncreasingOver(double low, double high) {
            for (var i = 0; i < _x.Length - 1; i++) {
                var from = Math.Max(low, _x[i]) - _x[i];
                var to = Math.Min(high, _x[i + 1]) - _x[i];
                if (to <= from) {
                    continue;
                }

                var lowest = Math.Min(Derivative(i, from), Derivative(i, to));
                if (_c3[i] != 0) {
                    var turn = -_c2[i] / (3 * _c3[i]);
                    if (turn > from && turn < to) {
                        lowest = Math.Min(lowest, Derivative(i, turn));
                    }
                }

                if (lowest < 0) {
                    return false;
                }
            }

            return true;
        }

        private double Derivative(int i, double u) => _slope[i] + u * (2 * _c2[i] + 3 * u * _c3[i]);

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
