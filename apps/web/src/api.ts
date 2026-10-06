import type { AuthStatus, PositionSnapshot, RiskSummary, ScreenerResult } from "@options-risk/shared";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.method && init.method !== "GET" ? (init.body ?? "{}") : init?.body,
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as { message?: string };
      throw new Error(parsed.message || text || res.statusText);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(text || res.statusText);
      }
      throw err;
    }
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const api = {
  authStatus: () => json<AuthStatus>("/api/auth/status"),
  startAuth: () => json<{ authorizeUrl: string | null; requestToken?: string; mockMode: boolean }>("/api/auth/start", { method: "POST" }),
  completeAuth: (requestToken: string, verifier: string) =>
    json<{ connected: boolean }>("/api/auth/complete", {
      method: "POST",
      body: JSON.stringify({ requestToken, verifier }),
    }),
  logout: () => json<{ connected: boolean }>("/api/auth/logout", { method: "POST" }),
  refresh: () => json<PositionSnapshot>("/api/positions/refresh", { method: "POST" }),
  positions: () => json<{ snapshot: PositionSnapshot | null }>("/api/positions"),
  risk: () => json<{ summary: RiskSummary | null }>("/api/risk"),
  screener: () => json<{ screener: ScreenerResult }>("/api/screener"),
};
