import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RateChart } from "@/components/rate-chart";
import { TargetMeter } from "@/components/target-meter";
import { TargetDialog } from "@/components/target-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { currency, getLatest, getRates, getState, getTarget, parseRange, RANGES } from "@/lib/db";
import { when } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Wordmark, currency chip and theme toggle. */
function Header() {
  return (
    <header className="mb-8 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-bold tracking-tight">Kurs Watch</span>
        <Badge variant="secondary">{currency()} · BCA e-Rate</Badge>
      </div>
      <ThemeToggle />
    </header>
  );
}

/**
 * Dashboard page. Server-rendered on every request from the read-only SQLite DB.
 * `?range=24h|7d|30d|all` picks the chart/stat window (default 30d); the hero always shows the newest reading.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const { min: TARGET_MIN, max: TARGET_MAX } = getTarget();
  const [cur, prev] = getLatest();
  const lastOk = getState("last_ok");
  const lastError = getState("last_error");
  const fails = Number(getState("consecutive_failures") || 0);

  if (!cur) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Header />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-lg font-medium">No readings yet</p>
            <p className="text-muted-foreground">
              The monitor stores its first reading on startup. Reload in a minute.
            </p>
            {lastError && <p className="font-mono text-sm text-warn">{lastError}</p>}
          </CardContent>
        </Card>
      </main>
    );
  }

  const rates = getRates(RANGES[range]);
  const week = getRates(7);
  const jual = rates.map((r) => r.jual);
  const low = Math.min(...jual, cur.jual);
  const high = Math.max(...jual, cur.jual);
  const low7 = Math.min(...week.map((r) => r.jual), cur.jual);
  const spread = ((cur.jual - cur.beli) / cur.beli) * 100;
  const delta = prev ? cur.jual - prev.jual : 0;
  const inBand = cur.jual >= TARGET_MIN && cur.jual <= TARGET_MAX;
  const gap = cur.jual - TARGET_MAX;
  const points = rates.map((r) => ({ t: new Date(r.ts).getTime(), jual: r.jual, beli: r.beli }));

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 pb-16">
      <Header />

      <Card className="mb-6">
        <CardContent className="grid gap-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm text-muted-foreground">Rp per ¥1, what you pay in myBCA</p>
            <p className="my-1 text-7xl leading-none font-bold tracking-tighter sm:text-8xl">
              {cur.jual.toFixed(2)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge className={cn(inBand ? "bg-good/15 text-good" : "bg-warn/15 text-warn")}>
                {inBand ? "In target" : gap > 0 ? "Above target" : "Below floor"}
              </Badge>
              {prev && delta !== 0 && (
                <span className={cn("inline-flex items-center gap-1 text-sm", delta < 0 ? "text-good" : "text-warn")}>
                  {delta < 0 ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}
                  {Math.abs(delta).toFixed(2)} since last reading
                </span>
              )}
            </div>
            <p className="mt-3 text-sm">
              {inBand
                ? `Inside your target (${TARGET_MIN > 0 ? `${TARGET_MIN} to ` : "up to "}${TARGET_MAX}).`
                : gap > 0
                  ? `${gap.toFixed(2)} above your ${TARGET_MAX} target, about ${((gap / cur.jual) * 100).toFixed(1)}% to fall.`
                  : `Below your floor of ${TARGET_MIN}.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">BCA updated {when(cur.ts)}</p>
            <div className="mt-4"><TargetDialog min={TARGET_MIN} max={TARGET_MAX} /></div>
          </div>
          <TargetMeter cur={cur.jual} low={low} high={high} min={TARGET_MIN} max={TARGET_MAX} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Rate history</CardTitle>
          <nav aria-label="Time range" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
              <Link
                key={k}
                href={`/?range=${k}`}
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
            <RateChart points={points} min={TARGET_MIN} max={TARGET_MAX} />
          ) : (
            <p className="py-16 text-center text-muted-foreground">
              Fewer than two readings in this range. Pick a longer range, or wait for BCA's next update.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-6 md:grid-cols-4 md:divide-x">
            {[
              [`Low (${range})`, low.toFixed(2)],
              [`High (${range})`, high.toFixed(2)],
              ["7-day low", low7.toFixed(2)],
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

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", fails > 0 ? "bg-warn" : "bg-good")} aria-hidden />
              Monitor {fails > 0 ? "failing" : "healthy"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">Last successful check {when(lastOk)}</p>
            {fails > 0 && (
              <>
                <p className="text-warn">{fails} failed polls in a row</p>
                {lastError && <p className="rounded-md bg-muted p-2 font-mono text-xs break-words">{lastError}</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Recent readings</CardTitle>
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
                    <TableCell className="text-right font-medium">{r.jual.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.beli.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{r.notesJual?.toFixed(2) ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
