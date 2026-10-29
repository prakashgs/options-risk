import type { EarningsFlag } from "@options-risk/shared";

// A single date inside a Yahoo payload, as a Unix timestamp, a formatted day, or both.
interface YahooDatePoint {
  raw?: number;
  fmt?: string;
}

// Yahoo's earnings calendar entry: one or more dates, and whether Yahoo is estimating them.
interface YahooEarnings {
  earningsDate?: YahooDatePoint | YahooDatePoint[];
  isEarningsDateEstimate?: boolean;
}

// The quoteSummary response for Yahoo's calendarEvents module, narrowed to the earnings path.
interface YahooCalendarResponse {
  quoteSummary?: {
    result?: Array<{
      calendarEvents?: {
        earnings?: YahooEarnings;
      };
    }> | null;
  };
}

// Today's calendar day as YYYY-MM-DD in the local timezone.
function isoToday(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Turns a Yahoo date into YYYY-MM-DD, using the formatted day when it is already one and otherwise the Unix timestamp.
function pointToIso(point: YahooDatePoint): string | null {
  if (typeof point.fmt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(point.fmt)) {
    return point.fmt;
  }
  if (typeof point.raw === "number" && Number.isFinite(point.raw)) {
    const date = new Date(point.raw * 1000);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

// Builds an earnings flag from the earliest Yahoo earnings date that is still today or later.
function nextEarningsFlag(symbol: string, earnings: YahooEarnings | undefined, today: string): EarningsFlag | null {
  const points = earnings?.earningsDate;
  const list = Array.isArray(points) ? points : points ? [points] : [];
  const date = list
    .map(pointToIso)
    .filter((value): value is string => value != null && value >= today)
    .sort()[0];
  if (!date) return null;
  return {
    symbol,
    date,
    estimated: earnings?.isEarningsDateEstimate === true,
  };
}

// Loads Yahoo's earnings calendar for one symbol and returns its next earnings flag, or null when the lookup fails.
export async function fetchNextEarnings(symbol: string): Promise<EarningsFlag | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooCalendarResponse;
    const earnings = data.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    return nextEarningsFlag(symbol, earnings, isoToday());
  } catch {
    return null;
  }
}

// Loads the next earnings flag for each distinct symbol and keeps only the symbols that have one.
export async function fetchEarningsFlags(symbols: string[]): Promise<EarningsFlag[]> {
  const unique = [...new Set(symbols.filter((symbol) => symbol.length > 0))];
  const flags = await Promise.all(unique.map((symbol) => fetchNextEarnings(symbol)));
  return flags.filter((flag): flag is EarningsFlag => flag != null);
}
