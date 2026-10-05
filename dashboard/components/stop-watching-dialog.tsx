"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { stopWatching, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

/** Confirm dialog: stop watching `code` and delete its `count` stored readings. */
export function StopWatchingDialog({ code, count }: { code: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(stopWatching, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
        <Trash2 className="size-3.5" /> Stop watching
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop watching {code}?</DialogTitle>
          <DialogDescription>
            This deletes the watch and all {count} stored {code} readings. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="code" value={code} />
          {state?.error && <p role="alert" className="text-sm text-warn">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep watching</Button>
            <Button type="submit" variant="destructive" disabled={pending}>{pending ? "Deleting" : `Delete ${code} data`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
