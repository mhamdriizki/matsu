"use client";

import { useActionState } from "react";
import { addCurrency, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CatalogueItem } from "@/lib/db";

/** Form behind the "+" tab: pick a currency BCA lists, set its band, start watching. */
export function AddCurrencyForm({ options }: { options: CatalogueItem[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addCurrency, null);

  if (options.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground">
        No currencies to add yet. The list fills after the monitor's next poll, and every currency BCA lists is already watched once it is full.
      </p>
    );
  }
  return (
    <form action={action} className="mx-auto max-w-md space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="add-code">Currency</Label>
        <select
          id="add-code"
          name="code"
          required
          defaultValue=""
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="" disabled>Pick a currency</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>{o.code} · {o.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="add-min">Min (0 = no floor)</Label>
          <Input id="add-min" name="min" type="number" step="any" min="0" inputMode="decimal" defaultValue={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="add-max">Max</Label>
          <Input id="add-max" name="max" type="number" step="any" min="0" inputMode="decimal" required />
        </div>
      </div>
      {state?.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Adding" : "Start watching"}</Button>
    </form>
  );
}
