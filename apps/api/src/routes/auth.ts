import type { FastifyInstance } from "fastify";
import type { AuthStatus } from "@options-risk/shared";
import { config, etradeEnvironment } from "../config.js";
import { store } from "../store.js";
import { exchangeVerifier, requestAuthorizeUrl } from "../integrations/etrade/oauth.js";

const pending = new Map<string, { requestTokenSecret: string }>();

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async (): Promise<AuthStatus> => {
    const tokens = store.readTokens();
    return {
      connected: config.mockMode || Boolean(tokens?.oauthToken && tokens.oauthTokenSecret),
      mockMode: config.mockMode,
      environment: etradeEnvironment(),
      hasConsumerKey: Boolean(config.etrade.consumerKey),
    };
  });

  app.post("/api/auth/start", async () => {
    if (config.mockMode) {
      return { authorizeUrl: null, mockMode: true };
    }
    const started = await requestAuthorizeUrl();
    pending.set(started.requestToken, { requestTokenSecret: started.requestTokenSecret });
    return { authorizeUrl: started.authorizeUrl, requestToken: started.requestToken, mockMode: false };
  });

  app.post<{
    Body: { requestToken: string; verifier: string };
  }>("/api/auth/complete", async (req) => {
    const secret = pending.get(req.body.requestToken)?.requestTokenSecret;
    if (!secret) {
      throw Object.assign(new Error("Unknown request token. Start OAuth again."), { statusCode: 400 });
    }
    await exchangeVerifier({
      requestToken: req.body.requestToken,
      requestTokenSecret: secret,
      verifier: req.body.verifier,
    });
    pending.delete(req.body.requestToken);
    return { connected: true };
  });

  app.post("/api/auth/logout", async () => {
    store.clearTokens();
    return { connected: false };
  });
}
