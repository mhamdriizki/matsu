import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCurrencyForm } from "@/components/add-currency-form";
import { CurrencyPanel } from "@/components/currency-panel";
import { CurrencyTabs, type TabItem } from "@/components/currency-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { dbReady, getCatalogue, getFlags, getLatest, getState, getWatches, parseRange } from "@/lib/db";
import { dp, fmt, when } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Wordmark, source chip and theme toggle. */
function Header() {
  return (
    <header className="mb-8 flex items-center justify-between border-b-2 border-gold/60 pb-4">
      <div className="flex items-center gap-3">
        <Image src="/logo-mark.png" alt="" width={48} height={48} unoptimized className="size-12" />
        <span className="text-3xl leading-none font-extrabold tracking-tight">Matsu</span>
        <span className="hidden text-sm text-muted-foreground sm:inline" lang="ja">待つ</span>
        <Badge variant="secondary">BCA e-Rate</Badge>
      </div>
      <ThemeToggle />
    </header>
  );
}

/** Monitor status (shared by all currencies): last successful poll and consecutive failures. */
function MonitorHealth() {
  const lastOk = getState("last_ok");
  const lastError = getState("last_error");
  const fails = Number(getState("consecutive_failures") || 0);
  return (
    <Card className="mt-6">
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
  );
}

/**
 * Dashboard page, server-rendered on every request from the SQLite DB.
 * `?c=CODE` picks the open tab (default: first watched currency); `?range=24h|3d|7d|10d` picks the
 * chart/stat window (default 10d, the retention limit).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string; range?: string }> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);

  if (!dbReady()) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Header />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-lg font-medium">Waiting for the monitor</p>
            <p className="text-muted-foreground">The monitor creates the database on startup. Reload in a minute.</p>
            {getState("last_error") && <p className="font-mono text-sm text-warn">{getState("last_error")}</p>}
          </CardContent>
        </Card>
      </main>
    );
  }

  const watches = getWatches();
  const wanted = (sp.c ?? "").toUpperCase();
  const active = watches.some((w) => w.code === wanted) ? wanted : (watches[0]?.code ?? "add");

  const flags = getFlags();
  const items: TabItem[] = watches.map((w) => {
    const cur = getLatest(w.code)[0];
    const status = !cur ? "none" : cur.jual > w.max ? "above" : cur.jual < w.min ? "below" : "in";
    return { code: w.code, flag: flags[w.code], rate: cur ? fmt(cur.jual, dp(cur.jual)) : null, status };
  });
  const panels = Object.fromEntries(watches.map((w) => [w.code, <CurrencyPanel key={w.code} watch={w} range={range} flag={flags[w.code]} />]));

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 pb-16">
      <Header />
      {watches.length === 0 && (
        <p className="mb-4 text-muted-foreground">Not watching anything yet. Add a currency to get started.</p>
      )}
      <CurrencyTabs
        key={active}
        value={active}
        range={range}
        items={items}
        panels={panels}
        addPanel={<AddCurrencyForm options={getCatalogue()} />}
      />
      <MonitorHealth />
    </main>
  );
}
