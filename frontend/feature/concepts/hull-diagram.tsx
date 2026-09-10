/**
 * The convex-hull ladder, drawn.
 *
 * This is the one idea in the project that genuinely resists prose: "one operating point per
 * resolution, all taken at the same hull slope" is hard to hold in your head from a sentence, and
 * it is the central claim. Everything else on the concepts page is text plus a link to live data.
 *
 * Curves are generated rather than hand-drawn path data so the shape is actually a saturating
 * rate–quality curve, and so the selected points really do sit where the slope equals λ.
 */

const WIDTH = 460;
const HEIGHT = 300;
const PAD = { left: 48, right: 16, top: 20, bottom: 44 };

const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Log2-bitrate range the diagram spans, roughly 250 kb/s to 8 Mb/s. */
const X_MIN = 8;
const X_MAX = 13;
const Y_MIN = 55;
const Y_MAX = 100;

/** The shared slope every rung is selected at, in quality per unit of log2 bitrate. */
const LAMBDA = 4;

interface Rung {
  label: string;
  color: string;
  /** Quality this resolution saturates toward. */
  ceiling: number;
  /** Log2 bitrate where the curve starts climbing. */
  offset: number;
  /** How fast it saturates. */
  rate: number;
}

const RUNGS: Rung[] = [
  { label: "1080p", color: "var(--chart-1)", ceiling: 99, offset: 9.4, rate: 0.55 },
  { label: "720p", color: "var(--chart-2)", ceiling: 96, offset: 8.7, rate: 0.7 },
  { label: "480p", color: "var(--chart-3)", ceiling: 92, offset: 8.1, rate: 0.9 },
  { label: "360p", color: "var(--chart-4)", ceiling: 87, offset: 7.6, rate: 1.1 },
  { label: "240p", color: "var(--chart-5)", ceiling: 81, offset: 7.2, rate: 1.35 },
];

/** Saturating rate–quality curve: quality rises fast, then flattens. */
function quality(rung: Rung, x: number): number {
  if (x <= rung.offset) {
    return Y_MIN - 10;
  }

  return rung.ceiling - (rung.ceiling - Y_MIN + 12) * Math.exp(-rung.rate * (x - rung.offset));
}

/**
 * Where this resolution's curve has slope exactly λ — its operating point.
 *
 * Solved analytically: the curve's derivative is `rate·(ceiling − Y_MIN + 12)·e^(−rate·(x−offset))`,
 * so setting that equal to λ and rearranging gives x directly, with no search.
 */
function operatingPoint(rung: Rung): { x: number; y: number } {
  const x =
    rung.offset +
    Math.log((rung.rate * (rung.ceiling - Y_MIN + 12)) / LAMBDA) / rung.rate;
  return { x, y: quality(rung, x) };
}

const toX = (x: number) => PAD.left + ((x - X_MIN) / (X_MAX - X_MIN)) * PLOT_W;
const toY = (y: number) =>
  PAD.top + PLOT_H - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;

function curvePath(rung: Rung): string {
  const points: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / 60;
    const y = quality(rung, x);
    if (y < Y_MIN) continue;
    points.push(`${toX(x).toFixed(1)},${toY(Math.min(y, Y_MAX)).toFixed(1)}`);
  }
  return points.length ? `M ${points.join(" L ")}` : "";
}

/** The upper envelope: at each bitrate, the best quality any resolution reaches. */
function envelopePath(): string {
  const points: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / 60;
    const best = Math.max(...RUNGS.map((rung) => quality(rung, x)));
    if (best < Y_MIN) continue;
    points.push(`${toX(x).toFixed(1)},${toY(Math.min(best, Y_MAX)).toFixed(1)}`);
  }
  return points.length ? `M ${points.join(" L ")}` : "";
}

function Star({ x, y }: { x: number; y: number }) {
  const r = 5;
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r / 2.3;
    return `${(x + radius * Math.cos(angle)).toFixed(1)},${(y + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");

  return (
    <polygon
      points={points}
      fill="var(--chart-star-fill)"
      stroke="var(--chart-star-stroke)"
      strokeWidth={1}
    />
  );
}

export function HullDiagram() {
  const operating = RUNGS.map((rung) => ({ rung, point: operatingPoint(rung) }));

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full max-w-lg"
        role="img"
        aria-label="Rate–quality curves for five resolutions, their upper envelope, and the operating point selected on each at a shared slope."
      >
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="var(--border)"
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + PLOT_H}
          stroke="var(--border)"
        />

        {/* The envelope, drawn under the curves so the coloured lines stay readable on top. */}
        <path
          d={envelopePath()}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={3}
          strokeOpacity={0.28}
        />

        {RUNGS.map((rung) => (
          <path
            key={rung.label}
            d={curvePath(rung)}
            fill="none"
            stroke={rung.color}
            strokeWidth={1.6}
          />
        ))}

        {/* Equal-slope tangents. Same gradient on every curve — that is the whole selection rule. */}
        {operating.map(({ rung, point }) => {
          const dx = 0.55;
          const x1 = toX(point.x - dx);
          const y1 = toY(point.y - LAMBDA * dx);
          const x2 = toX(point.x + dx);
          const y2 = toY(point.y + LAMBDA * dx);
          return (
            <line
              key={`tangent-${rung.label}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}

        {operating.map(({ rung, point }) => (
          <Star key={`star-${rung.label}`} x={toX(point.x)} y={toY(point.y)} />
        ))}

        {operating.map(({ rung, point }) => (
          <text
            key={`label-${rung.label}`}
            x={toX(point.x) + 9}
            y={toY(point.y) + 4}
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {rung.label}
          </text>
        ))}

        <text
          x={PAD.left + PLOT_W / 2}
          y={HEIGHT - 12}
          fontSize={11}
          textAnchor="middle"
          fill="var(--muted-foreground)"
        >
          bitrate (log scale) →
        </text>
        <text
          x={-(PAD.top + PLOT_H / 2)}
          y={14}
          fontSize={11}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          transform="rotate(-90)"
        >
          quality (VMAF)
        </text>
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        Each coloured line is one resolution&apos;s rate–quality curve; the thick grey line is the
        upper envelope across all of them. The dashed tangents all share the same gradient λ, and
        each star is where that gradient touches its curve — the point past which doubling the
        bitrate no longer buys λ points of quality. A curve that flattens early gets a cheap rung;
        one still climbing is followed further up.
      </figcaption>
    </figure>
  );
}
