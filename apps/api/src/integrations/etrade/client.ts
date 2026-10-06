import type { Position, Quote } from "@options-risk/shared";
import { etradeGet } from "./oauth.js";

interface AccountListResponse {
  AccountListResponse?: {
    Accounts?: {
      Account?: Array<{ accountIdKey: string; accountDesc?: string }> | { accountIdKey: string };
    };
  };
}

interface PortfolioResponse {
  PortfolioResponse?: {
    AccountPortfolio?: Array<{
      Position?: PortfolioPosition[] | PortfolioPosition;
    }>;
  };
}

interface PortfolioPosition {
  symbolDescription?: string;
  lastTrade?: number;
  lastPrice?: number;
  Product?: {
    symbol?: string;
    securityType?: string;
    callPut?: string;
    expiryYear?: number;
    expiryMonth?: number;
    expiryDay?: number;
    strikePrice?: number;
    underlyingSymbol?: string;
  };
  Quick?: { lastTrade?: number };
  All?: { lastTrade?: number };
  quantity?: number;
  pricePaid?: number;
  marketValue?: number;
}

interface QuoteResponse {
  QuoteResponse?: {
    QuoteData?: QuoteData[] | QuoteData;
  };
}

interface QuoteData {
  dateTimeUTC?: number;
  Product?: { symbol?: string };
  All?: {
    lastTrade?: number;
    previousClose?: number;
    previousDayClose?: number;
    prevClose?: number;
    close?: number;
    changeClose?: number;
    changeClosePercentage?: number;
    percentChange?: number;
    bid?: number;
    ask?: number;
    Option?: {
      lastTrade?: number;
      impliedVolatility?: number;
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
      daysToExpiration?: number;
    };
  };
  Intraday?: { lastTrade?: number };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function optionQuoteSymbol(product: NonNullable<PortfolioPosition["Product"]>, expiration?: string): string | undefined {
  const underlier = product.underlyingSymbol || product.symbol;
  const optionType = product.callPut === "PUT" || product.callPut === "CALL" ? product.callPut : undefined;
  if (!underlier || !expiration || !optionType || product.strikePrice == null) return undefined;
  const [year, month, day] = expiration.split("-");
  return `${underlier}:${Number(year)}:${Number(month)}:${Number(day)}:${optionType}:${product.strikePrice}`;
}

function mapPosition(accountIdKey: string, row: PortfolioPosition): Position {
  const product = row.Product ?? {};
  const securityType = (product.securityType ?? "").toUpperCase();
  const isOption = securityType.includes("OPT") || Boolean(product.callPut);
  const expiration =
    product.expiryYear && product.expiryMonth && product.expiryDay
      ? `${product.expiryYear}-${pad(product.expiryMonth)}-${pad(product.expiryDay)}`
      : undefined;
  const equitySymbol = product.underlyingSymbol ?? product.symbol;
  const symbol = isOption ? optionQuoteSymbol(product, expiration) ?? product.symbol ?? row.symbolDescription ?? "UNKNOWN" : product.symbol ?? row.symbolDescription ?? "UNKNOWN";
  const lastTrade = row.Quick?.lastTrade ?? row.All?.lastTrade ?? row.lastTrade ?? row.lastPrice;
  return {
    accountIdKey,
    symbol,
    description: row.symbolDescription ?? product.symbol ?? "",
    quantity: Number(row.quantity ?? 0),
    type: isOption ? "option" : securityType.includes("EQ") ? "equity" : "other",
    underlying: isOption ? equitySymbol : product.symbol,
    expiration,
    strike: product.strikePrice,
    optionType: product.callPut === "PUT" || product.callPut === "CALL" ? product.callPut : undefined,
    pricePaid: row.pricePaid,
    marketValue: row.marketValue,
    lastTrade: lastTrade != null ? Number(lastTrade) : undefined,
  };
}

function mapQuote(row: QuoteData): Quote {
  const option = row.All?.Option;
  const all = row.All;
  return {
    symbol: row.Product?.symbol ?? "",
    last: Number(all?.lastTrade ?? row.Intraday?.lastTrade ?? option?.lastTrade ?? 0),
    previousClose: all?.previousClose ?? all?.previousDayClose ?? all?.prevClose,
    changeClose: all?.changeClose,
    changeClosePercentage: all?.changeClosePercentage ?? all?.percentChange,
    bid: all?.bid,
    ask: all?.ask,
    iv: option?.impliedVolatility,
    delta: option?.delta,
    gamma: option?.gamma,
    theta: option?.theta,
    vega: option?.vega,
    daysToExpiration: option?.daysToExpiration,
    asOf: row.dateTimeUTC ? new Date(row.dateTimeUTC * 1000).toISOString() : new Date().toISOString(),
  };
}

export async function listAccountIdKeys(): Promise<string[]> {
  const data = await etradeGet<AccountListResponse>("/v1/accounts/list.json");
  const accounts = asArray(data?.AccountListResponse?.Accounts?.Account);
  return accounts.map((a) => a.accountIdKey).filter(Boolean);
}

export async function fetchPortfolio(accountIdKey: string): Promise<Position[]> {
  const data = await etradeGet<PortfolioResponse>(
    `/v1/accounts/${encodeURIComponent(accountIdKey)}/portfolio.json?count=250&view=COMPLETE`,
  );
  if (!data) return [];
  const portfolios = asArray(data.PortfolioResponse?.AccountPortfolio);
  return portfolios.flatMap((p) => asArray(p.Position).map((row) => mapPosition(accountIdKey, row)));
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const quotes: Quote[] = [];
  for (let i = 0; i < unique.length; i += 25) {
    const chunk = unique.slice(i, i + 25);
    const path = `/v1/market/quote/${chunk.join(",")}.json?detailFlag=ALL`;
    const data = await etradeGet<QuoteResponse>(path);
    quotes.push(...asArray(data?.QuoteResponse?.QuoteData).map(mapQuote));
  }
  return quotes;
}

interface ExpireDateResponse {
  OptionExpireDateResponse?: {
    ExpirationDate?: Array<{ year?: number; month?: number; day?: number }> | { year?: number; month?: number; day?: number };
  };
}

interface OptionChainResponse {
  OptionChainResponse?: {
    OptionPair?: ChainPair[] | ChainPair;
  };
}

interface ChainPair {
  Put?: ChainPutRaw;
  Call?: ChainPutRaw;
}

interface ChainPutRaw {
  strikePrice?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  lastTrade?: number;
  last?: number;
  OptionGreeks?: { iv?: number; impliedVolatility?: number };
}

export interface ChainPut {
  strike: number;
  bid?: number;
  ask?: number;
  last?: number;
  iv?: number;
}

function mapChainPut(raw: ChainPutRaw | undefined): ChainPut | undefined {
  if (raw?.strikePrice == null) return undefined;
  const iv = raw.OptionGreeks?.iv ?? raw.OptionGreeks?.impliedVolatility;
  const bid = raw.bid != null ? Number(raw.bid) : undefined;
  const ask = raw.ask != null ? Number(raw.ask) : undefined;
  const last = raw.lastPrice ?? raw.lastTrade ?? raw.last;
  return {
    strike: Number(raw.strikePrice),
    bid: bid != null && Number.isFinite(bid) ? bid : undefined,
    ask: ask != null && Number.isFinite(ask) ? ask : undefined,
    last: last != null && Number.isFinite(Number(last)) ? Number(last) : undefined,
    iv: iv != null ? Number(iv) : undefined,
  };
}

export async function fetchExpireDates(symbol: string): Promise<Array<{ year: number; month: number; day: number }>> {
  const data = await etradeGet<ExpireDateResponse>(
    `/v1/market/optionexpiredate.json?symbol=${encodeURIComponent(symbol)}&expiryType=ALL`,
  );
  return asArray(data?.OptionExpireDateResponse?.ExpirationDate)
    .map((row) => ({ year: Number(row.year), month: Number(row.month), day: Number(row.day) }))
    .filter((row) => row.year && row.month && row.day);
}

export async function fetchPutChain(
  symbol: string,
  expiry: { year: number; month: number; day: number },
  nearStrike?: number,
): Promise<ChainPut[]> {
  const near = nearStrike != null ? `&strikePriceNear=${encodeURIComponent(String(nearStrike))}` : "";
  const data = await etradeGet<OptionChainResponse>(
    `/v1/market/optionchains.json?symbol=${encodeURIComponent(symbol)}&expiryYear=${expiry.year}&expiryMonth=${expiry.month}&expiryDay=${expiry.day}&chainType=PUT&noOfStrikes=50${near}`,
  );
  return asArray(data?.OptionChainResponse?.OptionPair)
    .map((pair) => mapChainPut(pair.Put))
    .filter((put): put is ChainPut => Boolean(put))
    .sort((a, b) => a.strike - b.strike);
}
