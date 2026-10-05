import type { Rate } from "../lib/db";

type Props = { rates: Rate[]; min: number; max: number };

// Dependency-free SVG line chart. The target band is drawn as a shaded corridor.
export default function Chart({ rates, min, max }: Props) {
  const W = 680, H = 260, L = 48, R = 12, T = 12, B = 28;
  if (rates.length < 2) {
    return <p className="empty">The chart needs at least two readings. Check back after the next poll.</p>;
  }
  const times = rates.map((r) => new Date(r.ts).getTime());
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const vals = rates.map((r) => r.jual);
  const lo = Math.min(...vals, max, min > 0 ? min : Infinity) - 0.6;
  const hi = Math.max(...vals, max) + 0.6;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const bandTop = y(max);
  const bandBottom = y(min > 0 ? min : lo);
  const path = rates.map((r, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(r.jual).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  const last = rates[rates.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Jual rate history with target band" className="chart">
      <rect x={L} y={bandTop} width={W - L - R} height={Math.max(0, bandBottom - bandTop)} className="band" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="tick">{v.toFixed(1)}</text>
        </g>
      ))}
      <text x={W - R - 4} y={bandTop - 5} textAnchor="end" className="bandlabel">target ≤ {max}</text>
      <path d={path} className="line" fill="none" />
      <circle cx={x(times[times.length - 1])} cy={y(last.jual)} r={4} className="dot" />
      <text x={L} y={H - 8} className="tick">{fmt(t0)}</text>
      <text x={W - R} y={H - 8} textAnchor="end" className="tick">{fmt(t1)}</text>
    </svg>
  );
}
