interface YahooChartResponse {
  chart?: {
    result?: Array<{
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

export async function fetchDailyCloses(symbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as YahooChartResponse;
  return (data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
    (close): close is number => close != null && Number.isFinite(close) && close > 0,
  );
}

export function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function rsi(values: number[], period = 14): number | undefined {
  if (values.length < period + 1) return undefined;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) avgGain += delta;
    else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
