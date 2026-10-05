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
