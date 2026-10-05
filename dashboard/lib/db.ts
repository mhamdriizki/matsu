import Database from "better-sqlite3";

/** One stored BCA reading. `ts` is BCA's own stamp when known, else our fetch time. */
export type Rate = {
  id: number;
  ts: string;
  beli: number;
  jual: number;
  notesJual: number | null;
};

/** A watched currency and its target band (`min` 0 = no floor). `inBand` is the monitor's last verdict. */
export type Watch = { code: string; min: number; max: number; inBand: boolean };
export type Target = { min: number; max: number };
export type CatalogueItem = { code: string; name: string };

/** Allowed `?range=` values mapped to a look-back in days. Keep max <= the monitor's RETENTION_DAYS (10). */
export const RANGES = { "24h": 1, "3d": 3, "7d": 7, "10d": 10 } as const;
export type RangeKey = keyof typeof RANGES;

/** Validate a raw `?range=` value; anything unknown falls back to 10d. */
export function parseRange(v: string | string[] | undefined): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "10d";
}

const path = () => process.env.DB_PATH || "/data/kurs.db";

/**
 * Run `fn` against a short-lived read-only connection.
 * Returns `fallback` when the DB or a table does not exist yet, or is briefly locked by the monitor.
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

/** True once the monitor has created the schema (the `watches` table exists). */
export function dbReady(): boolean {
  return withDb(
    (db) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='watches'").get(),
    false
  );
}

/** The watchlist in tab order. */
export function getWatches(): Watch[] {
  return withDb(
    (db) =>
      (
        db
          .prepare("SELECT currency, target_min, target_max, in_band FROM watches ORDER BY created_at, currency")
          .all() as { currency: string; target_min: number; target_max: number; in_band: number }[]
      ).map((r) => ({ code: r.currency, min: r.target_min, max: r.target_max, inBand: !!r.in_band })),
    []
  );
}

/** Currencies BCA lists that are not watched yet, for the Add dropdown. Empty until the monitor's first poll. */
export function getCatalogue(): CatalogueItem[] {
  return withDb(
    (db) =>
      db
        .prepare("SELECT code, name FROM currencies WHERE code NOT IN (SELECT currency FROM watches) ORDER BY code")
        .all() as CatalogueItem[],
    []
  );
}

/** Readings of `code` in the last `days` days, oldest first. */
export function getRates(code: string, days: number): Rate[] {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return withDb(
    (db) =>
      db
        .prepare(`SELECT ${COLS} FROM rates WHERE currency = ? AND fetched_at >= ? ORDER BY fetched_at`)
        .all(code, since) as Rate[],
    []
  );
}

/** The two newest readings of `code` regardless of range: `[current, previous?]`. */
export function getLatest(code: string): Rate[] {
  return withDb(
    (db) => db.prepare(`SELECT ${COLS} FROM rates WHERE currency = ? ORDER BY id DESC LIMIT 2`).all(code) as Rate[],
    []
  );
}

/** Number of stored readings of `code` (shown in the "stop watching" confirmation). */
export function countRates(code: string): number {
  return withDb(
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM rates WHERE currency = ?").get(code) as { n: number }).n,
    0
  );
}

/** Read one value from the monitor's `state` table (health, last error, ...). */
export function getState(key: string): string | null {
  return withDb(
    (db) => (db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null,
    null
  );
}

/** Validate a band. Returns an error message, or null if it is fine. */
export function validateTarget({ min, max }: Target): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Enter both numbers.";
  if (min < 0) return "Min must be 0 or more (0 = no floor).";
  if (max <= 0) return "Max must be above 0.";
  if (min > max) return "Min must not be above max.";
  return null;
}

const BUSY = "The monitor has not created the database yet, or it is locked. Try again.";

/**
 * Run `fn` on a short-lived read-write connection. `fn` returns an error message or null.
 * The dashboard's only writes go through here (add, edit target, stop watching).
 */
function withWriteDb(fn: (db: Database.Database) => string | null): string | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(path(), { fileMustExist: true, timeout: 5000 });
    return fn(db);
  } catch {
    return BUSY;
  } finally {
    db?.close();
  }
}

/** Start watching `code` with a band. The code must be in the BCA catalogue and not already watched. */
export function addWatch(code: string, t: Target): string | null {
  const bad = validateTarget(t);
  if (bad) return bad;
  return withWriteDb((db) => {
    if (!db.prepare("SELECT 1 FROM currencies WHERE code = ?").get(code))
      return "Unknown currency. The list fills after the monitor's next poll.";
    try {
      db.prepare("INSERT INTO watches(currency, target_min, target_max) VALUES(?,?,?)").run(code, t.min, t.max);
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY") return `${code} is already watched.`;
      throw e;
    }
    return null;
  });
}

/** Change the band of a watched currency and reset its alert state so the next poll alerts against it. */
export function setTarget(code: string, t: Target): string | null {
  const bad = validateTarget(t);
  if (bad) return bad;
  return withWriteDb((db) => {
    const r = db
      .prepare("UPDATE watches SET target_min = ?, target_max = ?, in_band = 0, band_low = NULL WHERE currency = ?")
      .run(t.min, t.max, code);
    return r.changes === 0 ? `${code} is no longer watched.` : null;
  });
}

/** Stop watching `code` and delete all of its stored readings, in one transaction. */
export function removeWatch(code: string): string | null {
  return withWriteDb((db) => {
    let changes = 0;
    db.transaction(() => {
      db.prepare("DELETE FROM rates WHERE currency = ?").run(code);
      changes = db.prepare("DELETE FROM watches WHERE currency = ?").run(code).changes;
    })();
    return changes === 0 ? `${code} is no longer watched.` : null;
  });
}
