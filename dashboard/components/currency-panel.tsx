import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RateChart } from "@/components/rate-chart";
import { StopWatchingDialog } from "@/components/stop-watching-dialog";
import { TargetDialog } from "@/components/target-dialog";
import { TargetMeter } from "@/components/target-meter";
import { countRates, getLatest, getRates, RANGES, type RangeKey, type Watch } from "@/lib/db";
import { dp, fmt, when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Everything for one currency: hero + target meter, history chart with range switch, stats, readings. */
export function CurrencyPanel({ watch, range }: { watch: Watch; range: RangeKey }) {
  const { code, min, max } = watch;
  const [cur, prev] = getLatest(code);

  if (!cur) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <p className="text-lg font-medium">No {code} readings yet</p>
          <p className="text-muted-foreground">The monitor stores the first one on its next poll. Reload in a minute.</p>
          <div className="flex justify-center gap-2">
            <TargetDialog code={code} min={min} max={max} />
            <StopWatchingDialog code={code} count={0} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const rates = getRates(code, RANGES[range]);
  const week = getRates(code, 7);
  const jual = rates.map((r) => r.jual);
  const low = Math.min(...jual, cur.jual);
  const high = Math.max(...jual, cur.jual);
  const low7 = Math.min(...week.map((r) => r.jual), cur.jual);
  const spread = ((cur.jual - cur.beli) / cur.beli) * 100;
  const delta = prev ? cur.jual - prev.jual : 0;
  const inBand = cur.jual >= min && cur.jual <= max;
  const gap = cur.jual - max;
  const d = dp(cur.jual);
  const points = rates.map((r) => ({ t: new Date(r.ts).getTime(), jual: r.jual, beli: r.beli }));

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm text-muted-foreground">Rp per 1 {code}, what you pay in myBCA</p>
            <p className="my-1 text-6xl leading-none font-bold tracking-tighter sm:text-7xl">{fmt(cur.jual, d)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge className={cn(inBand ? "bg-good/15 text-good" : "bg-warn/15 text-warn")}>
                {inBand ? "In target" : gap > 0 ? "Above target" : "Below floor"}
              </Badge>
              {prev && delta !== 0 && (
                <span className={cn("inline-flex items-center gap-1 text-sm", delta < 0 ? "text-good" : "text-warn")}>
                  {delta < 0 ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}
                  {fmt(Math.abs(delta), d)} since last reading
                </span>
              )}
            </div>
            <p className="mt-3 text-sm">
              {inBand
                ? `Inside your target (${min > 0 ? `${fmt(min, d)} to ` : "up to "}${fmt(max, d)}).`
                : gap > 0
                  ? `${fmt(gap, d)} above your ${fmt(max, d)} target, about ${((gap / cur.jual) * 100).toFixed(1)}% to fall.`
                  : `Below your floor of ${fmt(min, d)}.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">BCA updated {when(cur.ts)}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <TargetDialog code={code} min={min} max={max} />
              <StopWatchingDialog code={code} count={countRates(code)} />
            </div>
          </div>
          <TargetMeter cur={cur.jual} low={low} high={high} min={min} max={max} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Rate history</CardTitle>
          <nav aria-label="Time range" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Link
                key={k}
                href={`/?c=${code}&range=${k}`}
                aria-current={k === range ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  k === range ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {k}
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent>
          {points.length >= 2 ? (
            <RateChart points={points} min={min} max={max} />
          ) : (
            <p className="py-16 text-center text-muted-foreground">
              Fewer than two readings in this range. Pick a longer range, or wait for BCA's next update.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-6 md:grid-cols-4 md:divide-x">
            {[
              [`Low (${range})`, fmt(low, d)],
              [`High (${range})`, fmt(high, d)],
              ["7-day low", fmt(low7, d)],
              ["Bank spread", `${spread.toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="px-4 first:pl-0">
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="text-2xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent {code} readings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BCA time</TableHead>
                <TableHead className="text-right">Jual</TableHead>
                <TableHead className="text-right">Beli</TableHead>
                <TableHead className="text-right">Cash Jual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rates].reverse().slice(0, 20).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{when(r.ts)}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(r.jual, d)}</TableCell>
                  <TableCell className="text-right">{fmt(r.beli, d)}</TableCell>
                  <TableCell className="text-right">{r.notesJual != null ? fmt(r.notesJual, d) : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
