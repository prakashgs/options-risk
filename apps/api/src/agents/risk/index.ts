import type { ExpirationRisk, Position, Quote, RiskSummary, UnderlyingRisk } from "@options-risk/shared";
import { lastKnownSnapshot } from "../market-data/index.js";

const OPTION_MULTIPLIER = 100;

function quoteFor(quotes: Quote[], symbol: string): Quote | undefined {
  return quotes.find((q) => q.symbol === symbol);
}

function underlyingLast(quotes: Quote[], underlying?: string): number {
  if (!underlying) return 0;
  return quoteFor(quotes, underlying)?.last ?? 0;
}

function contractDelta(position: Position, quote: Quote | undefined): number {
  if (position.type === "equity") return position.quantity;
  const perShare = quote?.delta ?? (position.optionType === "CALL" ? 0.5 : -0.5);
  return perShare * position.quantity * OPTION_MULTIPLIER;
}

function contractGamma(position: Position, quote: Quote | undefined): number {
  if (position.type !== "option") return 0;
  return (quote?.gamma ?? 0) * position.quantity * OPTION_MULTIPLIER;
}

function contractTheta(position: Position, quote: Quote | undefined): number {
  if (position.type !== "option") return 0;
  return (quote?.theta ?? 0) * position.quantity * OPTION_MULTIPLIER;
}

function contractVega(position: Position, quote: Quote | undefined): number {
  if (position.type !== "option") return 0;
  return (quote?.vega ?? 0) * position.quantity * OPTION_MULTIPLIER;
}

export function computeRisk(): RiskSummary | null {
  const snapshot = lastKnownSnapshot();
  if (!snapshot) return null;

  const byUnderlyingMap = new Map<string, UnderlyingRisk>();
  const byExpirationMap = new Map<string, ExpirationRisk>();
  let netDelta = 0;
  let dollarDelta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let marketValue = 0;

  for (const position of snapshot.positions) {
    const quote = quoteFor(snapshot.quotes, position.symbol);
    const underlying = position.underlying ?? position.symbol;
    const underLast = underlyingLast(snapshot.quotes, underlying);
    const delta = contractDelta(position, quote);
    const g = contractGamma(position, quote);
    const t = contractTheta(position, quote);
    const v = contractVega(position, quote);
    const mv = position.marketValue ?? (quote?.last ?? 0) * position.quantity * (position.type === "option" ? OPTION_MULTIPLIER : 1);
    const dDelta = delta * underLast;

    netDelta += delta;
    dollarDelta += dDelta;
    gamma += g;
    theta += t;
    vega += v;
    marketValue += mv;

    const existing = byUnderlyingMap.get(underlying) ?? {
      underlying,
      netDelta: 0,
      dollarDelta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      marketValue: 0,
      positionCount: 0,
    };
    existing.netDelta += delta;
    existing.dollarDelta += dDelta;
    existing.gamma += g;
    existing.theta += t;
    existing.vega += v;
    existing.marketValue += mv;
    existing.positionCount += 1;
    byUnderlyingMap.set(underlying, existing);

    if (position.expiration) {
      const bucket = byExpirationMap.get(position.expiration) ?? {
        expiration: position.expiration,
        netDelta: 0,
        marketValue: 0,
        contracts: 0,
      };
      bucket.netDelta += delta;
      bucket.marketValue += mv;
      bucket.contracts += Math.abs(position.quantity);
      byExpirationMap.set(position.expiration, bucket);
    }
  }

  return {
    snapshotAsOf: snapshot.asOf,
    computedAt: new Date().toISOString(),
    source: snapshot.source,
    netDelta,
    dollarDelta,
    gamma,
    theta,
    vega,
    marketValue,
    byUnderlying: [...byUnderlyingMap.values()].sort((a, b) => Math.abs(b.dollarDelta) - Math.abs(a.dollarDelta)),
    byExpiration: [...byExpirationMap.values()].sort((a, b) => a.expiration.localeCompare(b.expiration)),
  };
}
