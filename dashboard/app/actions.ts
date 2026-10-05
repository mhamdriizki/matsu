"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addWatch, removeWatch, setTarget } from "@/lib/db";

export type ActionResult = { ok: boolean; error?: string };

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, blank: number) => {
  const v = text(f, k).replace(",", ".");
  return v === "" ? blank : Number(v);
};
/** Blank min means no floor (0); blank max is invalid. */
const band = (f: FormData) => ({ min: num(f, "min", 0), max: num(f, "max", NaN) });

/** "+" tab form: start watching a currency from the BCA list, then open its tab. */
export async function addCurrency(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const code = text(form, "code").toUpperCase();
  if (!code) return { ok: false, error: "Pick a currency." };
  const error = addWatch(code, band(form));
  if (error) return { ok: false, error };
  redirect(`/?c=${code}`);
}

/** "Edit target" form for one currency (hidden `code` field). */
export async function saveTarget(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const error = setTarget(text(form, "code").toUpperCase(), band(form));
  if (error) return { ok: false, error };
  revalidatePath("/");
  return { ok: true };
}

/** "Stop watching" confirmation: deletes the watch and its stored readings. */
export async function stopWatching(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const error = removeWatch(text(form, "code").toUpperCase());
  if (error) return { ok: false, error };
  redirect("/");
}
