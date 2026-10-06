import type { PositionSnapshot } from "@options-risk/shared";
import { config } from "../../config.js";
import { store } from "../../store.js";
import { fetchPortfolio, fetchQuotes, listAccountIdKeys } from "../../integrations/etrade/client.js";
import { mockSnapshot } from "../../integrations/etrade/mock.js";

function quoteSymbols(positions: PositionSnapshot["positions"]): string[] {
  const symbols = new Set<string>();
  for (const p of positions) {
    symbols.add(p.symbol);
    if (p.underlying) symbols.add(p.underlying);
  }
  return [...symbols];
}

export async function refreshFromEtrade(): Promise<PositionSnapshot> {
  if (config.mockMode) {
    const snapshot = mockSnapshot();
    store.writeSnapshot(snapshot);
    return snapshot;
  }

  const accounts = await listAccountIdKeys();
  if (accounts.length === 0) {
    throw new Error("E*TRADE returned no accounts");
  }
  const positions = (await Promise.all(accounts.map((id) => fetchPortfolio(id)))).flat();
  const quotes = await fetchQuotes(quoteSymbols(positions));
  const snapshot: PositionSnapshot = {
    asOf: new Date().toISOString(),
    source: "etrade",
    accountIdKey: accounts.join(","),
    positions,
    quotes,
  };
  store.writeSnapshot(snapshot);
  return snapshot;
}

export function lastKnownSnapshot(): PositionSnapshot | null {
  return store.readSnapshot();
}
