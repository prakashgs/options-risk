import type { FastifyInstance } from "fastify";
import { lastKnownSnapshot, refreshFromEtrade } from "../agents/market-data/index.js";
import { computeRisk } from "../agents/risk/index.js";
import { runScreener } from "../agents/screener/index.js";

export async function registerDomainRoutes(app: FastifyInstance) {
  app.post("/api/positions/refresh", async () => refreshFromEtrade());

  app.get("/api/positions", async () => {
    const snapshot = lastKnownSnapshot();
    if (!snapshot) {
      return { snapshot: null };
    }
    return { snapshot };
  });

  app.get("/api/risk", async () => {
    const summary = computeRisk();
    if (!summary) {
      return { summary: null };
    }
    return { summary };
  });

  app.get("/api/screener", async () => ({ screener: runScreener() }));
}
