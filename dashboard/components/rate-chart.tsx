"use client";

import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { day, dp, fmt, padded, when } from "@/lib/format";

export type Point = { t: number; jual: number; beli: number };

const config = {
  jual: { label: "Jual (you pay)", color: "var(--chart-1)" },
  beli: { label: "Beli", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Jual/Beli history with the target corridor shaded. `min` 0 means "no floor". Padding and decimals scale with the rate. */
export function RateChart({ points, min, max }: { points: Point[]; min: number; max: number }) {
  const vals = points.flatMap((p) => [p.jual, p.beli]);
  const [lo, hi] = padded(Math.min(...vals, max, min > 0 ? min : Infinity), Math.max(...vals, max));
  const span = hi - lo;
  const tickDp = Math.min(2, Math.max(0, Math.ceil(-Math.log10(span / 4))));
  const width = 12 + 7 * fmt(hi, tickDp).length;

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72">
      <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
        <defs>
          <linearGradient id="fillJual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-jual)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-jual)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <ReferenceArea y1={min > 0 ? min : lo} y2={max} fill="var(--good)" fillOpacity={0.12} />
        <ReferenceLine
          y={max}
          stroke="var(--good)"
          strokeDasharray="4 4"
          label={{ value: `target ${fmt(max, dp(max))}`, position: "insideTopRight", fill: "var(--good)", fontSize: 11 }}
        />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={day}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
        />
        <YAxis
          domain={[lo, hi]}
          width={width}
          tickCount={5}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmt(v, tickDp)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, p) => (p?.[0] ? when(new Date(p[0].payload.t).toISOString()) : "")}
            />
          }
        />
        <Area dataKey="beli" type="monotone" stroke="var(--color-beli)" strokeWidth={1.5} fill="none" dot={false} />
        <Area dataKey="jual" type="monotone" stroke="var(--color-jual)" strokeWidth={2.5} fill="url(#fillJual)" dot={false} />
      </AreaChart>
    </ChartContainer>
  );
}
