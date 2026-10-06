import { useCallback, useEffect, useState } from "react";
import type { AuthStatus, Position, PositionSnapshot, Quote, RiskSummary, ScreenerResult, UnderlyingRisk } from "@options-risk/shared";
import { api } from "./api";

function money(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function expiryDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function signedClass(n: number | undefined): string {
  if (n == null || n === 0) return "num";
  return n > 0 ? "num gain" : "num loss";
}

function riskStatus(pctGain: number | undefined): { label: string; className: string } {
  if (pctGain == null) return { label: "—", className: "num" };
  if (pctGain > 0.5) return { label: "Positive++", className: "num status-positive-plus" };
  if (pctGain < -0.5) return { label: "Negative++", className: "num status-negative-plus" };
  if (pctGain > 0.1) return { label: "Positive", className: "num status-positive" };
  if (pctGain < -0.1) return { label: "Negative", className: "num status-negative" };
  return { label: "Neutral", className: "num status-neutral" };
}

function num(n: number, digits = 1): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function when(iso?: string): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [snapshot, setSnapshot] = useState<PositionSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [screener, setScreener] = useState<ScreenerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [verifier, setVerifier] = useState("");

  const load = useCallback(async () => {
    const [status, positions, riskRes, screenerRes] = await Promise.all([
      api.authStatus(),
      api.positions(),
      api.risk(),
      api.screener(),
    ]);
    setAuth(status);
    setSnapshot(positions.snapshot);
    setRisk(riskRes.summary);
    setScreener(screenerRes.screener);
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="kicker">Last-known book</p>
          <h1>Options risk</h1>
        </div>
        <div className="status">
          <span className={auth?.connected ? "pill on" : "pill"}>{auth?.environment ?? "…"}</span>
          <span className="muted">snapshot {when(snapshot?.asOf)}</span>
          <button disabled={busy} onClick={() => run(() => api.refresh())}>
            Refresh positions
          </button>
        </div>
      </header>

      {error ? <div className="banner">{error}</div> : null}

      <section className="connect">
        <h2>E*TRADE</h2>
        {auth?.mockMode ? (
          <p className="muted">
            Mock mode is on. Risk is computed from a sample book so you can use the app before wiring keys.
            Copy <code>.env.example</code> to <code>.env</code>, add your consumer key/secret, and set{" "}
            <code>MOCK_MODE=false</code>.
          </p>
        ) : auth?.connected && !requestToken ? (
          <div className="oauth">
            <p className="muted">Connected. Refresh pulls accounts, portfolio, and quotes, then overwrites the last-known snapshot.</p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.logout();
                  const started = await api.startAuth();
                  if (started.authorizeUrl) {
                    window.open(started.authorizeUrl, "_blank");
                    setRequestToken(started.requestToken ?? null);
                    setVerifier("");
                  }
                })
              }
            >
              Get new E*TRADE token
            </button>
          </div>
        ) : (
          <div className="oauth">
            <p className="muted">OAuth 1.0a: start, authorize in E*TRADE, paste the verifier.</p>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const started = await api.startAuth();
                  if (started.authorizeUrl) {
                    window.open(started.authorizeUrl, "_blank");
                    setRequestToken(started.requestToken ?? null);
                  }
                })
              }
            >
              Start E*TRADE login
            </button>
            {requestToken ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api.completeAuth(requestToken, verifier);
                    setRequestToken(null);
                    setVerifier("");
                  });
                }}
              >
                <input
                  value={verifier}
                  onChange={(e) => setVerifier(e.target.value)}
                  placeholder="Verifier code"
                />
                <button type="submit" disabled={busy || !verifier}>
                  Complete
                </button>
              </form>
            ) : null}
          </div>
        )}
      </section>

      <section className="metrics">
        <Metric label="Net delta" value={risk ? num(risk.netDelta, 0) : "—"} />
        <Metric label="Dollar delta" value={risk ? money(risk.dollarDelta) : "—"} />
        <Metric label="Gamma" value={risk ? num(risk.gamma, 2) : "—"} />
        <Metric label="Theta / day" value={risk ? money(risk.theta) : "—"} />
        <Metric label="Vega" value={risk ? num(risk.vega, 0) : "—"} />
        <Metric label="Mark" value={risk ? money(risk.marketValue) : "—"} />
      </section>

      <section>
        <h2>Risk:</h2>
        <RiskTable snapshot={snapshot} byUnderlying={risk?.byUnderlying ?? []} />
      </section>

      <section>
        <h2>Screener agent</h2>
        <p className="muted">{screener?.note}</p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <p className="kicker">{label}</p>
      <p className="metric">{value}</p>
    </article>
  );
}

function optionQuoteKey(position: Position): string | undefined {
  if (position.type !== "option" || !position.expiration || !position.optionType || position.strike == null) {
    return undefined;
  }
  const [year, month, day] = position.expiration.split("-");
  const underlier = position.underlying || position.symbol.split(":")[0];
  return `${underlier}:${Number(year)}:${Number(month)}:${Number(day)}:${position.optionType}:${position.strike}`;
}

function quoteForPosition(position: Position, quotes: Map<string, Quote>): Quote | undefined {
  if (position.type === "option") {
    const key = optionQuoteKey(position);
    return (key ? quotes.get(key) : undefined) ?? (position.symbol.includes(":") ? quotes.get(position.symbol) : undefined);
  }
  return quotes.get(position.symbol);
}

function optionMarks(position: Position, quote?: Quote) {
  const multiplier = 100;
  const lastFromValue =
    position.marketValue != null && position.quantity
      ? Math.abs(position.marketValue / (position.quantity * multiplier))
      : undefined;
  const lastTraded =
    (quote?.last && quote.last > 0 ? quote.last : undefined) ??
    (position.lastTrade && position.lastTrade > 0 ? position.lastTrade : undefined);
  const last = lastTraded ?? lastFromValue;
  const costBasis =
    position.pricePaid != null ? position.pricePaid * position.quantity * multiplier : undefined;
  const marketValue =
    position.marketValue ?? (last != null ? last * position.quantity * multiplier : undefined);
  const pnl = costBasis != null && marketValue != null ? marketValue - costBasis : undefined;
  const pctGain = pnl != null && costBasis ? pnl / Math.abs(costBasis) : undefined;
  return {
    last,
    lastTraded,
    costBasis,
    pnl,
    pct: pctGain,
  };
}

function spreadKey(position: Position): string {
  const underlying = position.underlying ?? position.symbol;
  return `${underlying}|${position.expiration ?? ""}`;
}

function spreadStatusBySymbol(positions: Position[], quotes: Map<string, Quote>): Map<string, { label: string; className: string }> {
  const legsBySpread = new Map<string, Position[]>();
  for (const position of positions) {
    if (position.type !== "option") continue;
    const key = spreadKey(position);
    const legs = legsBySpread.get(key) ?? [];
    legs.push(position);
    legsBySpread.set(key, legs);
  }

  const statusBySymbol = new Map<string, { label: string; className: string }>();
  for (const legs of legsBySpread.values()) {
    let costBasis = 0;
    let pnl = 0;
    let complete = 0;
    for (const leg of legs) {
      const marks = optionMarks(leg, quoteForPosition(leg, quotes));
      if (marks.costBasis == null || marks.pnl == null) continue;
      costBasis += marks.costBasis;
      pnl += marks.pnl;
      complete += 1;
    }
    const pctGain = complete > 0 && costBasis !== 0 ? pnl / Math.abs(costBasis) : undefined;
    const status = riskStatus(pctGain);
    for (const leg of legs) {
      statusBySymbol.set(leg.symbol, status);
    }
  }
  return statusBySymbol;
}

function optionGroups(snapshot: PositionSnapshot | null): { underlying: string; shares: number; options: Position[] }[] {
  const positions = snapshot?.positions ?? [];
  const groups = new Map<string, { underlying: string; shares: number; options: Position[] }>();

  for (const position of positions) {
    const underlying = position.underlying ?? position.symbol;
    const group = groups.get(underlying) ?? { underlying, shares: 0, options: [] };
    if (position.type === "equity") {
      group.shares += position.quantity;
    } else if (position.type === "option") {
      group.options.push(position);
    }
    groups.set(underlying, group);
  }

  return [...groups.values()]
    .filter((group) => group.options.length > 0)
    .sort((a, b) => a.underlying.localeCompare(b.underlying))
    .map((group) => ({
      ...group,
      options: [...group.options].sort((a, b) => {
        const expiry = (a.expiration ?? "").localeCompare(b.expiration ?? "");
        if (expiry !== 0) return expiry;
        return (a.strike ?? 0) - (b.strike ?? 0);
      }),
    }));
}

function RiskTable({
  snapshot,
  byUnderlying,
}: {
  snapshot: PositionSnapshot | null;
  byUnderlying: UnderlyingRisk[];
}) {
  const groups = optionGroups(snapshot);
  const summary = new Map(byUnderlying.map((row) => [row.underlying, row]));
  const quotes = new Map((snapshot?.quotes ?? []).map((quote) => [quote.symbol, quote]));
  const spreadStatus = spreadStatusBySymbol(snapshot?.positions ?? [], quotes);

  if (!snapshot) {
    return <p className="muted">No snapshot yet. Refresh positions to create one.</p>;
  }
  if (groups.length === 0) {
    return <p className="muted">No option positions in the last-known book.</p>;
  }

  return (
    <div className="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Contract</th>
          <th>Qty</th>
          <th>Risk status</th>
          <th>Strike</th>
          <th>Last</th>
          <th>Expiry Date</th>
          <th>Cost Basis</th>
          <th>$Unrealized PNL</th>
          <th>%Gain/Loss</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((group) => {
          const totals = summary.get(group.underlying);
          const header = (
            <tr className="group" key={`${group.underlying}-head`}>
              <td colSpan={9}>
                <div className="group-bar">
                  <span>
                    {group.underlying}
                    {group.shares ? <span className="muted"> · {group.shares} sh</span> : null}
                  </span>
                  {totals ? (
                    <span className="muted">
                      Δ {num(totals.netDelta, 0)} · {money(totals.dollarDelta)} · Θ {money(totals.theta)}
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          );
          const rows = group.options.map((position) => {
            const marks = optionMarks(position, quoteForPosition(position, quotes));
            const status = spreadStatus.get(position.symbol) ?? riskStatus(marks.pct);
            return (
            <tr key={position.symbol}>
              <td>
                <div>{position.description || position.symbol}</div>
                <div className="muted tiny">{position.symbol}</div>
              </td>
              <td className="num">{position.quantity}</td>
              <td className={status.className}>{status.label}</td>
              <td className="num">{position.strike != null ? num(position.strike, 0) : "—"}</td>
              <td className="num">{marks.lastTraded != null ? money(marks.lastTraded, 2) : "—"}</td>
              <td>{expiryDate(position.expiration)}</td>
              <td className="num">{marks.costBasis != null ? money(marks.costBasis) : "—"}</td>
              <td className={signedClass(marks.pnl)}>{marks.pnl != null ? money(marks.pnl) : "—"}</td>
              <td className={signedClass(marks.pct)}>{marks.pct != null ? pct(marks.pct) : "—"}</td>
            </tr>
            );
          });
          return [header, ...rows];
        })}
      </tbody>
    </table>
    </div>
  );
}
