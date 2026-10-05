"use server";

import { revalidatePath } from "next/cache";
import { setTarget } from "@/lib/db";

export type TargetResult = { ok: boolean; error?: string };

/** Server action behind the "Edit target" form. Blank min means no floor (0). */
export async function saveTarget(_prev: TargetResult | null, form: FormData): Promise<TargetResult> {
  const raw = (k: string) => String(form.get(k) ?? "").trim().replace(",", ".");
  const min = raw("min") === "" ? 0 : Number(raw("min"));
  const max = raw("max") === "" ? NaN : Number(raw("max"));
  const error = setTarget({ min, max });
  if (error) return { ok: false, error };
  revalidatePath("/");
  return { ok: true };
}
