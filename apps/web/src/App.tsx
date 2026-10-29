import { useCallback, useEffect, useState } from "react";
import type { AuthStatus, Position, PositionSnapshot, Quote, RiskSummary, ScreenerIdea, ScreenerResult, UnderlyingRisk } from "@options-risk/shared";
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

function daysUntil(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day);
  if (target.getFullYear() !== year || target.getMonth() !== month - 1 || target.getDate() !== day) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function upcomingEarnings(
  earnings: PositionSnapshot["earnings"],
  underlying: string,
): { label: string; soon: boolean } | null {
  const flag = earnings?.find((row) => row.symbol === underlying);
  if (!flag) return null;
  const days = daysUntil(flag.date);
  if (days == null || days < 0) return null;
  const [, month, day] = flag.date.split("-");
  return { label: `Earnings ${Number(month)}/${Number(day)}`, soon: days <= 7 };
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
        <Metric label="Mark" value={risk ? money(risk.marketValue) : "—"} />
      </section>

      <section>
        <h2>Risk:</h2>
        <RiskTable snapshot={snapshot} byUnderlying={risk?.byUnderlying ?? []} />
      </section>

      <section>
        <h2>Screener:</h2>
        <ScreenerTable screener={screener} />
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

function lotAtStrike(
  lots: Array<{ strike: number; qty: number }>,
  strike: number,
): { strike: number; qty: number } | undefined {
  return lots.find((lot) => lot.qty > 0 && Math.abs(lot.strike - strike) < 0.01);
}

function pickHedge(
  kind: "CALL" | "PUT",
  shortStrike: number,
  longs: Array<{ strike: number; qty: number }>,
): { strike: number; qty: number } | undefined {
  const available = longs.filter((leg) => leg.qty > 0);
  if (available.length === 0) return undefined;
  const preferred = kind === "PUT" ? [shortStrike - 10, shortStrike - 5] : [shortStrike + 10, shortStrike + 5];
  for (const strike of preferred) {
    const exact = lotAtStrike(available, strike);
    if (exact) return exact;
  }
  const protective =
    kind === "PUT"
      ? available.filter((leg) => leg.strike < shortStrike)
      : available.filter((leg) => leg.strike > shortStrike);
  const pool = protective.length > 0 ? protective : available;
  if (protective.length > 0) {
    return kind === "PUT"
      ? pool.reduce((best, leg) => (leg.strike > best.strike ? leg : best))
      : pool.reduce((best, leg) => (leg.strike < best.strike ? leg : best));
  }
  return pool.reduce((best, leg) =>
    Math.abs(leg.strike - shortStrike) < Math.abs(best.strike - shortStrike) ? leg : best,
  );
}

function hedgeRank(kind: "CALL" | "PUT", shortStrike: number, longs: Array<{ strike: number; qty: number }>): number {
  const target10 = kind === "PUT" ? shortStrike - 10 : shortStrike + 10;
  const target5 = kind === "PUT" ? shortStrike - 5 : shortStrike + 5;
  if (lotAtStrike(longs, target10)) return 0;
  if (lotAtStrike(longs, target5)) return 1;
  return 2;
}

function spreadWidthCapital(legs: Position[]): { capital: number; width5: number; width10: number } {
  const empty = { capital: 0, width5: 0, width10: 0 };
  const options = legs.filter((leg) => leg.type === "option" && leg.strike != null && leg.optionType);
  if (options.length === 0) return empty;
  const kind = options[0].optionType;
  if (kind !== "CALL" && kind !== "PUT") return empty;
  const shorts = options
    .filter((leg) => leg.quantity < 0 && leg.strike != null)
    .map((leg) => ({ strike: leg.strike as number, qty: -leg.quantity }));
  const longs = options
    .filter((leg) => leg.quantity > 0 && leg.strike != null)
    .map((leg) => ({ strike: leg.strike as number, qty: leg.quantity }));
  if (shorts.length === 0 || longs.length === 0) return empty;
  shorts.sort((a, b) => {
    const rank = hedgeRank(kind, a.strike, longs) - hedgeRank(kind, b.strike, longs);
    if (rank !== 0) return rank;
    return kind === "PUT" ? b.strike - a.strike : a.strike - b.strike;
  });

  const totals = { capital: 0, width5: 0, width10: 0 };
  for (const short of shorts) {
    while (short.qty > 0) {
      const hedge = pickHedge(kind, short.strike, longs);
      if (!hedge) break;
      const matched = Math.min(short.qty, hedge.qty);
      const width = Math.abs(short.strike - hedge.strike);
      totals.capital += width * 100 * matched;
      if (Math.abs(width - 5) < 0.01) totals.width5 += matched;
      if (Math.abs(width - 10) < 0.01) totals.width10 += matched;
      short.qty -= matched;
      hedge.qty -= matched;
    }
  }
  return totals;
}

function totalSpreadRisk(groups: { options: Position[] }[]): { capital: number; width5: number; width10: number } {
  const bySpread = new Map<string, Position[]>();
  for (const group of groups) {
    for (const position of group.options) {
      const key = `${position.underlying ?? ""}|${position.expiration ?? ""}|${position.optionType ?? ""}`;
      if (position.optionType !== "PUT") continue;
      const legs = bySpread.get(key) ?? [];
      legs.push(position);
      bySpread.set(key, legs);
    }
  }
  const totals = { capital: 0, width5: 0, width10: 0 };
  for (const legs of bySpread.values()) {
    const part = spreadWidthCapital(legs);
    totals.capital += part.capital;
    totals.width5 += part.width5;
    totals.width10 += part.width10;
  }
  return totals;
}

type RiskSort = "default" | "risk-desc" | "risk-asc";

function putRiskForGroup(group: { options: Position[] }): number {
  return totalSpreadRisk([group]).capital;
}

function sortRiskGroups(
  groups: { underlying: string; shares: number; options: Position[] }[],
  sort: RiskSort,
) {
  const copy = [...groups];
  if (sort === "default") {
    return copy.sort((a, b) => a.underlying.localeCompare(b.underlying));
  }
  return copy.sort((a, b) => {
    const delta = putRiskForGroup(a) - putRiskForGroup(b);
    const ordered = sort === "risk-desc" ? -delta : delta;
    return ordered !== 0 ? ordered : a.underlying.localeCompare(b.underlying);
  });
}

function matchesSymbolFilter(group: { underlying: string; options: Position[] }, query: string): boolean {
  const needle = query.trim().toUpperCase();
  if (!needle) return true;
  if (group.underlying.toUpperCase().includes(needle)) return true;
  return group.options.some((position) => {
    const haystack = `${position.symbol} ${position.description} ${position.underlying ?? ""}`.toUpperCase();
    return haystack.includes(needle);
  });
}

function RiskTable({
  snapshot,
  byUnderlying,
}: {
  snapshot: PositionSnapshot | null;
  byUnderlying: UnderlyingRisk[];
}) {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [riskSort, setRiskSort] = useState<RiskSort>("default");
  const groups = optionGroups(snapshot);
  const visible = sortRiskGroups(
    groups.filter((group) => matchesSymbolFilter(group, symbolFilter)),
    riskSort,
  );
  const spreadRisk = totalSpreadRisk(visible);
  const summary = new Map(byUnderlying.map((row) => [row.underlying, row]));
  const quotes = new Map((snapshot?.quotes ?? []).map((quote) => [quote.symbol, quote]));
  const spreadStatus = spreadStatusBySymbol(snapshot?.positions ?? [], quotes);

  if (!snapshot) {
    return <p className="muted">No snapshot yet. Refresh positions to create one.</p>;
  }

  return (
    <>
      <div className="risk-toolbar">
        <div className="risk-controls">
          <input
            aria-label="Filter risk table by symbol"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            placeholder="Filter by symbol"
          />
          <select
            aria-label="Sort risk table"
            value={riskSort}
            onChange={(e) => setRiskSort(e.target.value as RiskSort)}
          >
            <option value="default">Default</option>
            <option value="risk-desc">Risk high to low</option>
            <option value="risk-asc">Risk low to high</option>
          </select>
        </div>
        <div className="risk-totals">
          <article className="risk-total">
            <p className="kicker">Total risk</p>
            <p className="metric">{money(spreadRisk.capital)}</p>
          </article>
          <article className="risk-total">
            <p className="kicker">5-wide</p>
            <p className="metric">{spreadRisk.width5}</p>
          </article>
          <article className="risk-total">
            <p className="kicker">10-wide</p>
            <p className="metric">{spreadRisk.width10}</p>
          </article>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="muted">No option positions in the last-known book.</p>
      ) : visible.length === 0 ? (
        <p className="muted">No positions match “{symbolFilter.trim()}”.</p>
      ) : (
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
        {visible.flatMap((group) => {
          const totals = summary.get(group.underlying);
          const putRisk = putRiskForGroup(group);
          const earnings = upcomingEarnings(snapshot.earnings, group.underlying);
          const header = (
            <tr className="group" key={`${group.underlying}-head`}>
              <td colSpan={9}>
                <div className="group-bar">
                  <span>
                    {group.underlying}
                    {earnings ? (
                      <span className={earnings.soon ? "earnings soon" : "earnings"}> · {earnings.label}</span>
                    ) : null}
                    {group.shares ? <span className="muted"> · {group.shares} sh</span> : null}
                  </span>
                  <span className="muted">
                    Risk {money(putRisk)}
                    {totals ? (
                      <>
                        {" "}
                        · Δ {num(totals.netDelta, 0)} · {money(totals.dollarDelta)} · Θ {money(totals.theta)}
                      </>
                    ) : null}
                  </span>
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
      )}
    </>
  );
}

function byRoiDesc(ideas: ScreenerIdea[]) {
  return [...ideas].sort((a, b) => (b.optionsRoiPct ?? Number.NEGATIVE_INFINITY) - (a.optionsRoiPct ?? Number.NEGATIVE_INFINITY));
}

function ScreenerTable({ screener }: { screener: ScreenerResult | null }) {
  const names = byRoiDesc(screener?.ideas ?? []);
  if (names.length === 0) {
    return <p className="muted">No names from the screener agent yet.</p>;
  }
  return (
    <div className="table-wrap screener">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th className="num sorted">Options ROI % ↓</th>
            <th className="num">Last</th>
            <th className="num">Change %</th>
            <th className="num">RSI</th>
            <th className="num">200D SMA</th>
            <th className="num">LastVs200D</th>
            <th className="num">Spread</th>
            <th className="num">Implied Vol</th>
          </tr>
        </thead>
        <tbody>
          {names.map((idea) => (
            <tr key={idea.symbol}>
              <td>{idea.symbol}</td>
              <td className="num">{idea.optionsRoiPct != null ? pct(idea.optionsRoiPct) : "—"}</td>
              <td className="num">{idea.last != null ? money(idea.last, 2) : "—"}</td>
              <td className={signedClass(idea.changePct)}>{idea.changePct != null ? pct(idea.changePct) : "—"}</td>
              <td className="num">{idea.rsi != null ? num(idea.rsi, 1) : "—"}</td>
              <td className="num">{idea.sma200 != null ? money(idea.sma200, 2) : "—"}</td>
              <td className={signedClass(idea.lastVs200D)}>{idea.lastVs200D != null ? pct(idea.lastVs200D) : "—"}</td>
              <td className="num">
                {idea.strike1 != null && idea.strike2 != null ? `(${idea.strike1}, ${idea.strike2})` : "—"}
              </td>
              <td className="num">{idea.impliedVol != null ? pct(idea.impliedVol) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
