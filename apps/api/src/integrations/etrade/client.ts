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
  return {
    symbol: row.Product?.symbol ?? "",
    last: Number(row.All?.lastTrade ?? row.Intraday?.lastTrade ?? row.All?.Option?.lastTrade ?? 0),
    bid: row.All?.bid,
    ask: row.All?.ask,
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
