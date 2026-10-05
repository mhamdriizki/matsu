"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type TabItem = { code: string; rate: string | null; status: "in" | "above" | "below" | "none" };

const DOT = { in: "bg-good", above: "bg-warn", below: "bg-primary", none: "bg-muted-foreground/40" } as const;

type Props = {
  value: string;                      // initial tab: a currency code, or "add"
  range: string;
  items: TabItem[];
  panels: Record<string, ReactNode>;  // server-rendered; Base UI mounts only the active one
  addPanel: ReactNode;
};

/**
 * One tab per watched currency (code, current rate, status dot) plus a "+" tab. Switching is instant
 * (panels are already rendered); the URL is kept in sync with replaceState so `?c=` can be bookmarked.
 */
export function CurrencyTabs({ value, range, items, panels, addPanel }: Props) {
  const [tab, setTab] = useState(value);

  const onChange = (v: unknown) => {
    const next = String(v);
    setTab(next);
    window.history.replaceState(null, "", next === "add" ? `/?range=${range}` : `/?c=${next}&range=${range}`);
  };

  return (
    <Tabs value={tab} onValueChange={onChange} className="gap-4">
      <TabsList className="h-auto w-full max-w-full justify-start gap-1 overflow-x-auto p-1">
        {items.map((it) => (
          <TabsTrigger key={it.code} value={it.code} className="h-auto flex-none flex-col items-start gap-0 px-4 py-2">
            <span className="flex items-center gap-2 font-semibold">
              <span className={cn("size-2 rounded-full", DOT[it.status])} aria-hidden />
              {it.code}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{it.rate ?? "no data"}</span>
          </TabsTrigger>
        ))}
        <TabsTrigger value="add" aria-label="Add currency" className="h-auto flex-none px-3 py-2">
          <Plus className="size-4" />
        </TabsTrigger>
      </TabsList>
      {items.map((it) => (
        <TabsContent key={it.code} value={it.code}>{panels[it.code]}</TabsContent>
      ))}
      <TabsContent value="add">{addPanel}</TabsContent>
    </Tabs>
  );
}
