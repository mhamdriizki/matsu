import Database from "better-sqlite3";

/** One stored BCA reading. `ts` is BCA's own stamp when known, else our fetch time. */
export type Rate = {
  id: number;
  ts: string;
  beli: number;
  jual: number;
  notesJual: number | null;
};

/** Allowed `?range=` values mapped to a look-back in days (`null` = everything). */
export const RANGES = { "24h": 1, "7d": 7, "30d": 30, all: null } as const;
export type RangeKey = keyof typeof RANGES;

/** Validate a raw `?range=` value; anything unknown falls back to 30d. */
export function parseRange(v: string | string[] | undefined): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30d";
}

const path = () => process.env.DB_PATH || "/data/kurs.db";
export const currency = () => (process.env.CURRENCY || "JPY").toUpperCase();

/**
 * Run `fn` against a short-lived read-only connection.
 * Returns `fallback` when the DB does not exist yet or is briefly locked by the monitor.
 */
function withDb<T>(fn: (db: Database.Database) => T, fallback: T): T {
  let db: Database.Database | null = null;
  try {
    db = new Database(path(), { readonly: true, fileMustExist: true });
    return fn(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

const COLS = `id, COALESCE(source_updated_at, fetched_at) AS ts,
              erate_beli AS beli, erate_jual AS jual, notes_jual AS notesJual`;

/** Readings for the configured currency in the last `days` days, oldest first. `null` = all. */
export function getRates(days: number | null): Rate[] {
  const since = days === null ? "" : new Date(Date.now() - days * 86400_000).toISOString();
  return withDb(
    (db) =>
      db
        .prepare(
          `SELECT ${COLS} FROM rates WHERE currency = ? AND fetched_at >= ? ORDER BY fetched_at`
        )
        .all(currency(), since) as Rate[],
    []
  );
}

/** The two newest readings regardless of range: `[current, previous?]`. */
export function getLatest(): Rate[] {
  return withDb(
    (db) =>
      db
        .prepare(`SELECT ${COLS} FROM rates WHERE currency = ? ORDER BY id DESC LIMIT 2`)
        .all(currency()) as Rate[],
    []
  );
}

/** Read one value from the monitor's `state` table (health, last error, ...). */
export function getState(key: string): string | null {
  return withDb(
    (db) => (db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null,
    null
  );
}

/** Target band for the verdict and alerts: [min, max] in Rp per unit. `min` 0 means no floor. */
export type Target = { min: number; max: number };

/**
 * Current target. The dashboard-saved value (state keys `target_min` / `target_max`)
 * wins; the TARGET_MIN / TARGET_MAX env vars are only the default before the first save.
 */
export function getTarget(): Target {
  const min = Number(getState("target_min") ?? process.env.TARGET_MIN ?? 0);
  const max = Number(getState("target_max") ?? process.env.TARGET_MAX ?? 113);
  return { min, max };
}

/**
 * Persist a new target where the monitor reads it, and reset the monitor's band
 * state so the next poll alerts against the new band. Returns an error message, or null on success.
 * This is the dashboard's only write; it uses a short-lived read-write connection.
 */
export function setTarget({ min, max }: Target): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Enter both numbers.";
  if (min < 0 || max <= 0) return "Values must be positive (min may be 0 for no floor).";
  if (min > max) return "Min must not be above max.";
  let db: Database.Database | null = null;
  try {
    db = new Database(path(), { fileMustExist: true, timeout: 5000 });
    const put = db.prepare("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    db.transaction(() => {
      put.run("target_min", String(min));
      put.run("target_max", String(max));
      put.run("in_band", "0");
      put.run("band_low", "inf");
    })();
    return null;
  } catch {
    return "Could not save. The monitor has not created the database yet, or it is locked. Try again.";
  } finally {
    db?.close();
  }
}
