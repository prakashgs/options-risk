import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(env("API_PORT", "8787")),
  webOrigin: env("WEB_ORIGIN", "http://localhost:5173"),
  mockMode: env("MOCK_MODE", "true") === "true",
  etrade: {
    consumerKey: env("ETRADE_CONSUMER_KEY"),
    consumerSecret: env("ETRADE_CONSUMER_SECRET"),
    baseUrl: env("ETRADE_BASE_URL", "https://apisb.etrade.com").replace(/\/$/, ""),
  },
};

export function etradeEnvironment(): "sandbox" | "production" | "mock" {
  if (config.mockMode) return "mock";
  return config.etrade.baseUrl.includes("apisb") ? "sandbox" : "production";
}
