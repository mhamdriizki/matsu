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
