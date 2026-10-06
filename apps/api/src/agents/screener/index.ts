import type { ScreenerResult } from "@options-risk/shared";
import { lastKnownSnapshot } from "../market-data/index.js";

export function runScreener(): ScreenerResult {
  const snapshot = lastKnownSnapshot();
  return {
    generatedAt: new Date().toISOString(),
    status: "stub",
    ideas: [],
    note: snapshot
      ? "Screener agent is a reserved boundary. It will scan names related to the last-known book (IV rank, unusual options, defined-risk structures) without mixing that work into the risk engine."
      : "Screener agent is stubbed. Refresh a position snapshot first so later scans have a book to work from.",
  };
}
