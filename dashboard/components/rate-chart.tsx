"use client";

import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { day, when } from "@/lib/format";

export type Point = { t: number; jual: number; beli: number };

const config = {
  jual: { label: "Jual (you pay)", color: "var(--chart-1)" },
  beli: { label: "Beli", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Jual/Beli history with the target corridor shaded. `min` 0 means "no floor". */
export function RateChart({ points, min, max }: { points: Point[]; min: number; max: number }) {
  const vals = points.flatMap((p) => [p.jual, p.beli]);
  const lo = Math.floor(Math.min(...vals, max, min > 0 ? min : Infinity) - 0.5);
  const hi = Math.ceil(Math.max(...vals, max) + 0.5);

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
          label={{ value: `target ${max}`, position: "insideTopRight", fill: "var(--good)", fontSize: 11 }}
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
        <YAxis domain={[lo, hi]} width={40} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(0)} />
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
