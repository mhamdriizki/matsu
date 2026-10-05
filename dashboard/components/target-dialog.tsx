"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { saveTarget, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Dialog to edit one currency's target band. Saved values are shared with the monitor via the DB. */
export function TargetDialog({ code, min, max }: { code: string; min: number; max: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveTarget, null);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-3.5" /> Edit target
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{code} target rate</DialogTitle>
          <DialogDescription>
            You get an alert when the rate is between min and max. The monitor picks this up on its next poll.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="code" value={code} />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`min-${code}`}>Min (0 = no floor)</Label>
              <Input id={`min-${code}`} name="min" type="number" step="any" min="0" inputMode="decimal" defaultValue={min} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`max-${code}`}>Max</Label>
              <Input id={`max-${code}`} name="max" type="number" step="any" min="0" inputMode="decimal" defaultValue={max} required />
            </div>
          </div>
          {state?.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save target"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
