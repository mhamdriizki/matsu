import Database from "better-sqlite3";

export type Rate = {
  ts: string; // BCA's own timestamp when known, else our fetch time
  beli: number;
  jual: number;
  notesJual: number | null;
};

const path = () => process.env.DB_PATH || "/data/kurs.db";
export const currency = () => (process.env.CURRENCY || "JPY").toUpperCase();

function withDb<T>(fn: (db: Database.Database) => T, fallback: T): T {
  let db: Database.Database | null = null;
  try {
    db = new Database(path(), { readonly: true, fileMustExist: true });
    return fn(db);
  } catch {
    return fallback; // DB not created yet, or momentarily locked by the writer
  } finally {
    db?.close();
  }
}

export function getRates(days: number): Rate[] {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return withDb(
    (db) =>
      db
        .prepare(
          `SELECT COALESCE(source_updated_at, fetched_at) AS ts,
                  erate_beli AS beli, erate_jual AS jual, notes_jual AS notesJual
           FROM rates WHERE currency = ? AND fetched_at >= ?
           ORDER BY fetched_at`
        )
        .all(currency(), since) as Rate[],
    []
  );
}

export function getState(key: string): string | null {
  return withDb(
    (db) => (db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null,
    null
  );
}
