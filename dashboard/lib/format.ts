const TZ = "Asia/Jakarta";

/** "5 Oct, 14:00 WIB" for an ISO timestamp; "never" when missing. Always rendered in WIB. */
export function when(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ,
      }) + " WIB"
    : "never";
}

/** "5 Oct" in WIB, for chart axes. */
export function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ });
}

/** Decimals worth showing for a rate of this size: 2 for small rates (JPY ~113), 0 for large (SGD ~14,000). */
export const dp = (ref: number) => (ref < 1000 ? 2 : 0);

/** Number with thousands separators and a fixed number of decimals ("14,087"). */
export const fmt = (v: number, d: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Widen [lo, hi] by 8% of the span, but never less than 0.1% of the value, so a flat line still gets room
 * and the padding scales with the currency (JPY ~113 vs SGD ~14,000).
 */
export function padded(lo: number, hi: number): [number, number] {
  const pad = Math.max((hi - lo) * 0.08, hi * 0.001);
  return [lo - pad, hi + pad];
}
