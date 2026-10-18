import type { ScreenerIdea, ScreenerResult } from "@options-risk/shared";
import { config } from "../../config.js";
import { fetchExpireDates, fetchPutChain, fetchQuotes, type ChainPut } from "../../integrations/etrade/client.js";
import { fetchDailyCloses, rsi, sma } from "../../integrations/yahoo/history.js";

const WATCHLIST = ["NBIS", "APP", "DRAM", "SKHY", "MNDY", "HUBS", "INTU", "DXYZ", "AVGO", "SMH", "TEAM"];
const TARGET_DTE = 30;
const ROI_CAPITAL = 1000;
const SPREAD_WIDTH = 10;

function changePctFromQuote(quote: { last: number; previousClose?: number; changeClose?: number; changeClosePercentage?: number }): number | undefined {
  const prev = quote.previousClose;
  if (prev && prev > 0 && Math.abs(quote.last - prev) > 1e-6) {
    return (quote.last - prev) / prev;
  }
  if (quote.changeClose != null && quote.last) {
    const inferredPrev = quote.last - quote.changeClose;
    if (inferredPrev > 0 && Math.abs(quote.changeClose) > 1e-6) {
      return quote.changeClose / inferredPrev;
    }
  }
  if (quote.changeClosePercentage != null) {
    const raw = Number(quote.changeClosePercentage);
    return Math.abs(raw) > 1 ? raw / 100 : raw;
  }
  if (prev && prev > 0) return (quote.last - prev) / prev;
  return undefined;
}

function spreadCredit(shortLast: number, longLast: number): number | undefined {
  const credit = shortLast - longLast;
  if (!Number.isFinite(credit) || credit <= 0) return undefined;
  return credit;
}

function asIvFraction(iv: number | undefined): number | undefined {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return undefined;
  return iv > 2 ? iv / 100 : iv;
}

function lastPremium(put: ChainPut): number | undefined {
  if (put.last == null || !Number.isFinite(put.last) || put.last <= 0) return undefined;
  return put.last;
}

function optionPutSymbol(
  symbol: string,
  expiry: { year: number; month: number; day: number },
  strike: number,
): string {
  return `${symbol}:${expiry.year}:${expiry.month}:${expiry.day}:PUT:${strike}`;
}

async function lastForStrike(
  symbol: string,
  expiry: { year: number; month: number; day: number },
  put: ChainPut,
): Promise<number | undefined> {
  const fromChain = lastPremium(put);
  if (fromChain != null) return fromChain;
  const [optQuote] = await fetchQuotes([optionPutSymbol(symbol, expiry, put.strike)]);
  return optQuote?.last && optQuote.last > 0 ? optQuote.last : undefined;
}

function daysUntil(expiry: { year: number; month: number; day: number }): number {
  const target = Date.UTC(expiry.year, expiry.month - 1, expiry.day);
  return (target - Date.now()) / (24 * 60 * 60 * 1000);
}

function pickExpiry(dates: Array<{ year: number; month: number; day: number }>) {
  const future = dates.filter((d) => daysUntil(d) > 1);
  if (future.length === 0) return undefined;
  return [...future].sort((a, b) => Math.abs(daysUntil(a) - TARGET_DTE) - Math.abs(daysUntil(b) - TARGET_DTE))[0];
}

function putAtStrike(puts: ChainPut[], strike: number): ChainPut | undefined {
  return puts.find((p) => Math.abs(p.strike - strike) < 0.01);
}

function tenWidePair(puts: ChainPut[], oneSdStrike: number): { shortPut: ChainPut; longPut: ChainPut } | undefined {
  const pairs: Array<{ shortPut: ChainPut; longPut: ChainPut }> = [];
  for (const shortPut of puts) {
    const longPut = putAtStrike(puts, shortPut.strike - SPREAD_WIDTH);
    if (longPut) pairs.push({ shortPut, longPut });
  }
  if (pairs.length === 0) return undefined;
  return [...pairs].sort(
    (a, b) => Math.abs(a.shortPut.strike - oneSdStrike) - Math.abs(b.shortPut.strike - oneSdStrike),
  )[0];
}

function mockIdea(
  symbol: string,
  last: number,
  prev: number,
  iv: number,
  credit: number,
  strike1: number,
  strike2: number,
  rsiValue: number,
  sma200: number,
): ScreenerIdea {
  return {
    symbol,
    last,
    changePct: (last - prev) / prev,
    impliedVol: iv,
    strike1,
    strike2,
    optionsRoiPct: (credit * 100) / ROI_CAPITAL,
    rsi: rsiValue,
    sma200,
    lastVs200D: (last - sma200) / sma200,
    thesis: "",
    score: 0,
  };
}

function sortByRoi(ideas: ScreenerIdea[]): ScreenerIdea[] {
  return [...ideas].sort((a, b) => (b.optionsRoiPct ?? Number.NEGATIVE_INFINITY) - (a.optionsRoiPct ?? Number.NEGATIVE_INFINITY));
}

function withTrend(idea: ScreenerIdea, last: number | undefined, closes: number[]): ScreenerIdea {
  const rsiValue = rsi(closes);
  const sma200 = sma(closes, 200);
  const lastVs200D = last != null && sma200 ? (last - sma200) / sma200 : undefined;
  return { ...idea, rsi: rsiValue, sma200, lastVs200D };
}

async function screenSymbol(symbol: string): Promise<ScreenerIdea> {
  const blank: ScreenerIdea = { symbol, thesis: "", score: 0 };
  const [quote] = await fetchQuotes([symbol]);
  if (!quote?.last) return withTrend(blank, undefined, await fetchDailyCloses(symbol).catch(() => []));

  const [expiryDates, closes] = await Promise.all([
    fetchExpireDates(symbol),
    fetchDailyCloses(symbol).catch(() => [] as number[]),
  ]);
  const idea: ScreenerIdea = withTrend(
    { ...blank, last: quote.last, changePct: changePctFromQuote(quote) },
    quote.last,
    closes,
  );

  const expiry = pickExpiry(expiryDates);
  if (!expiry) return idea;

  const atmPuts = await fetchPutChain(symbol, expiry, quote.last);
  if (atmPuts.length === 0) return idea;

  const dte = Math.max(daysUntil(expiry), 1);
  const atmIv = asIvFraction(
    [...atmPuts]
      .sort((a, b) => Math.abs(a.strike - quote.last) - Math.abs(b.strike - quote.last))
      .find((p) => asIvFraction(p.iv) != null)?.iv,
  );
  if (atmIv == null) return idea;

  const oneSdStrike = quote.last * (1 - atmIv * Math.sqrt(dte / 365));
  const otmPuts = await fetchPutChain(symbol, expiry, oneSdStrike);
  const puts = [...atmPuts, ...otmPuts].filter((put, i, all) => all.findIndex((p) => p.strike === put.strike) === i);
  const pair = tenWidePair(puts, oneSdStrike);
  const shortPut = pair?.shortPut;
  let shortIv = asIvFraction(shortPut?.iv) ?? atmIv;
  if (shortPut && asIvFraction(shortPut.iv) == null) {
    const [optQuote] = await fetchQuotes([
      `${symbol}:${expiry.year}:${expiry.month}:${expiry.day}:PUT:${shortPut.strike}`,
    ]);
    shortIv = asIvFraction(optQuote?.iv) ?? shortIv;
  }
  idea.impliedVol = shortIv;

  if (!pair) return idea;
  idea.strike1 = pair.shortPut.strike;
  idea.strike2 = pair.longPut.strike;
  const shortLast = await lastForStrike(symbol, expiry, pair.shortPut);
  const longLast = await lastForStrike(symbol, expiry, pair.longPut);
  if (shortLast == null || longLast == null) return idea;
  const credit = spreadCredit(shortLast, longLast);
  if (credit == null) return idea;
  idea.optionsRoiPct = (credit * 100) / ROI_CAPITAL;
  return idea;
}

export async function runScreener(): Promise<ScreenerResult> {
  if (config.mockMode) {
    return {
      generatedAt: new Date().toISOString(),
      status: "ready",
      ideas: sortByRoi([
        mockIdea("NBIS", 232, 228, 0.72, 1.85, 180, 170, 62, 190),
        mockIdea("APP", 540, 548, 0.55, 2.1, 490, 480, 48, 510),
        mockIdea("DRAM", 52, 50.5, 0.8, 1.2, 40, 30, 71, 38),
        mockIdea("SKHY", 148, 146, 0.28, 0.9, 140, 130, 55, 142),
        mockIdea("MNDY", 250, 248, 0.45, 1.4, 220, 210, 40, 260),
        mockIdea("HUBS", 480, 485, 0.4, 1.6, 430, 420, 35, 520),
        mockIdea("INTU", 650, 645, 0.28, 1.1, 610, 600, 58, 600),
        mockIdea("DXYZ", 40, 39, 0.7, 0.8, 30, 20, 45, 36),
        mockIdea("AVGO", 180, 178, 0.35, 1.3, 160, 150, 64, 155),
        mockIdea("SMH", 280, 278, 0.3, 1.0, 260, 250, 60, 240),
        mockIdea("TEAM", 200, 198, 0.5, 1.2, 170, 160, 52, 185),
      ]),
      note: "Mock screener. Connect E*TRADE for live last, change, IV, and put-spread ROI.",
    };
  }

  const ideas: ScreenerIdea[] = [];
  for (const symbol of WATCHLIST) {
    try {
      ideas.push(await screenSymbol(symbol));
    } catch {
      ideas.push({ symbol, thesis: "", score: 0 });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    ideas: sortByRoi(ideas),
    note: "Last and change % from equity quotes. RSI (14) and 200D SMA from daily closes. LastVs200D is (last − 200D SMA) / 200D SMA. IV is the ~30-day put nearest 1σ OTM. Spread is the 10-wide put credit at that 1σ strike. ROI % is (short last − long last) × 100 / $1000. Sorted by ROI % descending.",
  };
}
