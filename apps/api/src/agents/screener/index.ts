import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenerIdea, ScreenerResult } from "@options-risk/shared";
import { config } from "../../config.js";
import { fetchExpireDates, fetchPutChain, fetchQuotes, type ChainPut } from "../../integrations/etrade/client.js";
import { fetchDailyCloses, rsi, sma } from "../../integrations/yahoo/history.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const WATCHLIST_FILE = "data/screener-watchlist.json";
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

function loadWatchlist(): { symbols: string[] } | { error: string } {
  const path = resolve(repoRoot, WATCHLIST_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { error: `Screener watchlist is missing. Add a JSON string array at ${WATCHLIST_FILE}.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: `Screener watchlist at ${WATCHLIST_FILE} is not valid JSON. Expected a string array.` };
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || item.trim() === "")) {
    return { error: `Screener watchlist at ${WATCHLIST_FILE} must be a JSON array of symbol strings.` };
  }
  return { symbols: parsed.map((item) => item.trim()) };
}

function emptyWatchlist(note: string): ScreenerResult {
  return {
    generatedAt: new Date().toISOString(),
    status: "stub",
    ideas: [],
    note,
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
  const watchlist = loadWatchlist();
  if ("error" in watchlist) return emptyWatchlist(watchlist.error);

  if (config.mockMode) {
    return {
      generatedAt: new Date().toISOString(),
      status: "ready",
      ideas: sortByRoi(watchlist.symbols.map((symbol) => mockIdea(symbol, 100, 98, 0.4, 1.2, 90, 80, 50, 95))),
      note: "Mock screener. Connect E*TRADE for live last, change, IV, and put-spread ROI.",
    };
  }

  const ideas: ScreenerIdea[] = [];
  for (const symbol of watchlist.symbols) {
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
