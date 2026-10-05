import Chart from "./Chart";
import { currency, getRates, getState } from "../lib/db";

export const dynamic = "force-dynamic";

const TARGET_MIN = Number(process.env.TARGET_MIN || 0);
const TARGET_MAX = Number(process.env.TARGET_MAX || 113);
const DAYS = 30;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
      }) + " WIB"
    : "never";

export default function Page() {
  const rates = getRates(DAYS);
  const lastOk = getState("last_ok");
  const lastError = getState("last_error");
  const fails = Number(getState("consecutive_failures") || 0);
  const cur = rates[rates.length - 1];

  if (!cur) {
    return (
      <main>
        <h1>{currency()} watch</h1>
        <p className="empty">No readings yet. The monitor writes its first one on startup; reload in a minute.</p>
        {lastError && <p className="warn">Last error: {lastError}</p>}
      </main>
    );
  }

  const inBand = cur.jual >= TARGET_MIN && cur.jual <= TARGET_MAX;
  const gap = cur.jual - TARGET_MAX;
  const cutoff7 = Date.now() - 7 * 86400_000;
  const last7 = rates.filter((r) => new Date(r.ts).getTime() >= cutoff7).map((r) => r.jual);
  const all = rates.map((r) => r.jual);
  const spread = ((cur.jual - cur.beli) / cur.beli) * 100;

  return (
    <main>
      <p className="meta">BCA e-Rate, Rp per ¥1, the price you pay in myBCA</p>
      <h1 className="rate">{cur.jual.toFixed(2)}</h1>
      <p className={inBand ? "verdict in" : "verdict out"}>
        {inBand
          ? `Inside your target (${TARGET_MIN > 0 ? TARGET_MIN + " to " : "up to "}${TARGET_MAX}).`
          : gap > 0
            ? `${gap.toFixed(2)} above your ${TARGET_MAX} target (${((gap / cur.jual) * 100).toFixed(1)}% to fall).`
            : `Below your floor of ${TARGET_MIN}.`}
      </p>
      <p className="meta">Updated {when(cur.ts)}</p>

      <Chart rates={rates} min={TARGET_MIN} max={TARGET_MAX} />

      <dl className="stats">
        <div><dt>7-day low</dt><dd>{last7.length ? Math.min(...last7).toFixed(2) : "-"}</dd></div>
        <div><dt>{DAYS}-day low</dt><dd>{Math.min(...all).toFixed(2)}</dd></div>
        <div><dt>{DAYS}-day high</dt><dd>{Math.max(...all).toFixed(2)}</dd></div>
        <div><dt>Bank spread</dt><dd>{spread.toFixed(1)}%</dd></div>
      </dl>

      <section>
        <h2>Monitor</h2>
        <p className={fails > 0 ? "warn" : "meta"}>
          Last successful check {when(lastOk)}
          {fails > 0 && ` · ${fails} failed polls in a row. ${lastError ?? ""}`}
        </p>
      </section>

      <section>
        <h2>Recent readings</h2>
        <table>
          <thead><tr><th>BCA time</th><th>Jual</th><th>Beli</th><th>Cash (Bank Notes) Jual</th></tr></thead>
          <tbody>
            {[...rates].reverse().slice(0, 20).map((r) => (
              <tr key={r.ts}>
                <td>{when(r.ts)}</td>
                <td>{r.jual.toFixed(2)}</td>
                <td>{r.beli.toFixed(2)}</td>
                <td>{r.notesJual?.toFixed(2) ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
