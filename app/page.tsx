import styles from "./page.module.css";
import { WATCHLIST } from "@/lib/config/watchlist";
import { getDb } from "@/lib/db";
import {
  getClosedPositionViews,
  getEquityCurve,
  getJournalViews,
  getLatestPortfolioSnapshot,
  getOpenPositionViews,
  getRecentCycles,
  getRecentRiskEvents,
  loadPaperSettings,
  type CycleView,
  type JournalView,
  type PositionView,
  type PortfolioSnapshotView,
  type RiskEventView,
} from "@/lib/persistence/repository";
import type { PaperSettings } from "@/lib/persistence/mappers";

export const dynamic = "force-dynamic";

interface DashboardData {
  portfolio: PortfolioSnapshotView | null;
  equity: { ts: string; equity: number }[];
  open: PositionView[];
  closed: PositionView[];
  journal: JournalView[];
  cycles: CycleView[];
  riskEvents: RiskEventView[];
  settings: PaperSettings | null;
}

async function loadDashboard(): Promise<DashboardData | null> {
  try {
    const db = getDb();
    const [portfolio, equity, open, closed, journal, cycles, riskEvents, settings] =
      await Promise.all([
        getLatestPortfolioSnapshot(db),
        getEquityCurve(db, 500),
        getOpenPositionViews(db),
        getClosedPositionViews(db, 25),
        getJournalViews(db, 50),
        getRecentCycles(db, 15),
        getRecentRiskEvents(db, 25),
        loadPaperSettings(db),
      ]);
    return { portfolio, equity, open, closed, journal, cycles, riskEvents, settings };
  } catch {
    // Fail closed: never render invented numbers when the database is down.
    return null;
  }
}

const usdt = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const price = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: 6 });

const when = (iso: string | null): string => {
  if (!iso) return "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "OK"
      ? styles.badgeOk
      : status === "PARTIAL"
        ? styles.badgeWarn
        : status === "ERROR"
          ? styles.badgeBad
          : styles.badgeNeutral;
  return <span className={`${styles.badge} ${cls}`}>{status}</span>;
}

function Sparkline({ points }: { points: { ts: string; equity: number }[] }) {
  if (points.length < 2) {
    return (
      <p className={styles.empty}>
        Equity history appears after at least two paper cycles have been recorded.
      </p>
    );
  }
  const w = 640;
  const h = 180;
  const pad = 14;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((p.equity - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${h - pad} ${coords.join(" ")} ${w - pad},${h - pad}`;
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={styles.sparkline}
        role="img"
        aria-label={`Paper equity curve across ${points.length} snapshots`}
      >
        <polygon points={area} className={styles.sparkArea} />
        <polyline points={coords.join(" ")} className={styles.sparkLine} />
      </svg>
      <div className={styles.sparkMeta}>
        <span>Low {usdt(min)} USDT</span>
        <span>{points.length} snapshots</span>
        <span>High {usdt(max)} USDT</span>
      </div>
    </div>
  );
}

function OpenPositions({ rows }: { rows: PositionView[] }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No open paper positions.</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>Target</th>
            <th>Margin</th>
            <th>Max hold until</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className={styles.symbol}>{p.symbol}</td>
              <td>
                <span className={p.side === "LONG" ? styles.long : styles.short}>{p.side}</span>
              </td>
              <td>{price(p.qty)}</td>
              <td>{price(p.entryPrice)}</td>
              <td>{price(p.stopLoss)}</td>
              <td>{price(p.takeProfit)}</td>
              <td>{usdt(p.margin)}</td>
              <td>{when(p.maxHoldUntil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosedPositions({ rows }: { rows: PositionView[] }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No closed paper positions yet.</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Realized PnL</th>
            <th>Reason</th>
            <th>Closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className={styles.symbol}>{p.symbol}</td>
              <td>
                <span className={p.side === "LONG" ? styles.long : styles.short}>{p.side}</span>
              </td>
              <td>{price(p.entryPrice)}</td>
              <td>{price(p.exitPrice)}</td>
              <td className={p.realizedPnl !== null && p.realizedPnl < 0 ? styles.neg : styles.pos}>
                {p.realizedPnl === null ? "—" : `${usdt(p.realizedPnl)} USDT`}
              </td>
              <td>
                {p.closeReason ?? "—"}
                {p.gapThroughStop ? <span className={styles.gap}>gap-through-stop</span> : null}
              </td>
              <td>{when(p.closedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetupNotice() {
  return (
    <section className={styles.setup}>
      <h2>Database unavailable</h2>
      <p>
        The dashboard could not read paper-trading state, so it is showing nothing rather than
        inventing numbers. The bot itself also refuses to guess when data is missing.
      </p>
      <ol>
        <li>
          Make sure PostgreSQL is running on port 5432 and that <code>DATABASE_URL</code> in{" "}
          <code>.env</code> points at a database named <code>watchlist_bot</code>. Never share that
          file — it contains credentials.
        </li>
        <li>
          Run <code>npm run setup:db</code> once to create the database and apply the schema.
        </li>
        <li>
          Record a paper cycle with <code>npm run paper:once</code> (it falls back to in-memory and
          warns loudly if the database is still unreachable).
        </li>
        <li>Reload this page.</li>
      </ol>
      <p className={styles.muted}>
        You can validate the pipeline without a database: <code>npm run paper:once -- --no-db --no-news</code>
      </p>
    </section>
  );
}

export default async function Home() {
  const data = await loadDashboard();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>watchlist-news-bot</p>
          <h1>Paper trading console</h1>
          <p className={styles.muted}>
            Intraday crypto futures on a fixed 7-symbol watchlist. Every trade is simulated; no real
            order can be placed by this build.
          </p>
        </div>
        <div className={styles.paperBadge}>PAPER MODE</div>
      </header>

      <div className={styles.banner}>
        Live trading is disabled in code behind three independent gates and was never enabled. All
        balances, positions, and PnL below are simulated paper results, not guarantees of future
        performance.
      </div>

      {data !== null && (data.settings?.dailyLossHalted || data.settings?.drawdownHalted) ? (
        <div className={styles.halt}>
          <strong>NEW ENTRIES HALTED.</strong>{" "}
          {data.settings.drawdownHalted
            ? "The total-drawdown limit was breached; the halt persists until manually reset. "
            : ""}
          {data.settings.dailyLossHalted
            ? "The daily-loss limit was breached; entries stay blocked until the next UTC day. "
            : ""}
          Existing positions are still managed by their stop, target, and max-hold rules.
        </div>
      ) : null}

      {data === null ? (
        <SetupNotice />
      ) : (
        <>
          <section className={styles.cards}>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Equity</span>
              <span className={styles.cardValue}>
                {data.portfolio ? `${usdt(data.portfolio.equity)} USDT` : "—"}
              </span>
              <span className={styles.cardHint}>
                {data.portfolio ? `snapshot ${when(data.portfolio.ts)}` : "no snapshot yet"}
              </span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Cash</span>
              <span className={styles.cardValue}>
                {data.portfolio ? `${usdt(data.portfolio.cashBalance)} USDT` : "—"}
              </span>
              <span className={styles.cardHint}>locked margin excluded</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Unrealized PnL</span>
              <span
                className={`${styles.cardValue} ${
                  data.portfolio && data.portfolio.unrealizedPnl < 0 ? styles.neg : styles.pos
                }`}
              >
                {data.portfolio ? `${usdt(data.portfolio.unrealizedPnl)} USDT` : "—"}
              </span>
              <span className={styles.cardHint}>marked to latest 1m close</span>
            </div>
            <div className={styles.card}>
              <span className={styles.cardLabel}>Open positions</span>
              <span className={styles.cardValue}>
                {data.portfolio ? data.portfolio.openPositionCount : data.open.length}
                <span className={styles.cardOf}> / 3 max</span>
              </span>
              <span className={styles.cardHint}>risk engine caps concurrency</span>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Equity curve</h2>
              <span className={styles.muted}>paper snapshots, oldest to newest</span>
            </div>
            <Sparkline points={data.equity} />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Open positions</h2>
              <span className={styles.muted}>{data.open.length} open</span>
            </div>
            <OpenPositions rows={data.open} />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Closed positions</h2>
              <span className={styles.muted}>most recent {data.closed.length}</span>
            </div>
            <ClosedPositions rows={data.closed} />
          </section>

          <div className={styles.split}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>Recent cycles</h2>
              </div>
              {data.cycles.length === 0 ? (
                <p className={styles.empty}>
                  No paper cycles recorded yet. Run <code>npm run paper:once</code>.
                </p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Finished</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cycles.map((c) => (
                        <tr key={c.id}>
                          <td>{c.id}</td>
                          <td>
                            <StatusBadge status={c.status} />
                          </td>
                          <td>{when(c.startedAt)}</td>
                          <td>{when(c.finishedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>Risk events</h2>
                <span className={styles.muted}>blocks and halts</span>
              </div>
              {data.riskEvents.length === 0 ? (
                <p className={styles.empty}>No risk breaches recorded.</p>
              ) : (
                <ul className={styles.eventList}>
                  {data.riskEvents.map((e) => (
                    <li key={e.id} className={styles.event}>
                      <div className={styles.eventTop}>
                        <span className={styles.eventLimit}>
                          {e.limit} · {e.action}
                        </span>
                        <span className={styles.muted}>{when(e.createdAt)}</span>
                      </div>
                      <div>
                        {e.symbol ? <span className={styles.symbol}>{e.symbol}</span> : null}{" "}
                        {e.message}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Journal</h2>
              <span className={styles.muted}>most recent {data.journal.length}</span>
            </div>
            {data.journal.length === 0 ? (
              <p className={styles.empty}>Journal is empty.</p>
            ) : (
              <ul className={styles.journal}>
                {data.journal.map((j) => (
                  <li key={j.id} className={styles.journalItem}>
                    <span className={styles.journalKind}>{j.kind}</span>
                    <span className={styles.journalMsg}>{j.message}</span>
                    <span className={styles.journalMeta}>
                      {j.symbol ? `${j.symbol} · ` : ""}
                      {when(j.ts)}
                      {j.cycleId !== null ? ` · cycle ${j.cycleId}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Fixed watchlist</h2>
          <span className={styles.muted}>the only symbols the bot may ever trade</span>
        </div>
        <ul className={styles.chips}>
          {WATCHLIST.map((s) => (
            <li key={s} className={styles.chip}>
              {s}
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.footer}>
        Read-only dashboard · source: PostgreSQL · three-gate live guard · fail-closed by design
      </footer>
    </main>
  );
}
