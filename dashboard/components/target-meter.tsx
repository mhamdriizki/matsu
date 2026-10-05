type Props = { cur: number; low: number; high: number; min: number; max: number };

/**
 * Where the current rate sits between the period's low and high, with the
 * target zone (everything from the floor up to `max`) shaded.
 */
export function TargetMeter({ cur, low, high, min, max }: Props) {
  const a = Math.min(low, max, cur) - 0.5;
  const b = Math.max(high, max, cur) + 0.5;
  const pct = (v: number) => `${(((v - a) / (b - a)) * 100).toFixed(2)}%`;
  const zoneL = min > 0 ? pct(min) : "0%";
  const inZone = cur >= min && cur <= max;

  return (
    <div
      role="img"
      aria-label={`Current ${cur.toFixed(2)}, target up to ${max}, period low ${low.toFixed(2)}, high ${high.toFixed(2)}`}
      className="pt-9 pb-7"
    >
      <div className="relative h-2.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-good/25"
          style={{ left: zoneL, width: `calc(${pct(max)} - ${zoneL})` }}
        />
        <div className="absolute -inset-y-1 w-px bg-good" style={{ left: pct(max) }}>
          <span className="absolute -bottom-6 -translate-x-1/2 text-xs text-good whitespace-nowrap">target {max}</span>
        </div>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pct(cur) }}>
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-xs font-medium whitespace-nowrap">now</span>
          <span
            className={`block size-5 rounded-full border-4 border-card shadow ring-2 ${
              inZone ? "bg-good ring-good" : "bg-primary ring-primary"
            }`}
          />
        </div>
      </div>
      <div className="mt-8 flex justify-between text-xs text-muted-foreground">
        <span>low {low.toFixed(2)}</span>
        <span>high {high.toFixed(2)}</span>
      </div>
    </div>
  );
}
