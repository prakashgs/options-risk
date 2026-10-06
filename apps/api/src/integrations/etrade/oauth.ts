import OAuth from "oauth-1.0a";
import { createHmac } from "node:crypto";
import { config } from "../../config.js";
import { store, type StoredTokens } from "../../store.js";

export class EtradeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtradeAuthError";
  }
}

function oauth() {
  const { consumerKey, consumerSecret } = config.etrade;
  if (!consumerKey || !consumerSecret) {
    throw new EtradeAuthError("Set ETRADE_CONSUMER_KEY and ETRADE_CONSUMER_SECRET in .env");
  }
  return new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(base, key) {
      return createHmac("sha1", key).update(base).digest("base64");
    },
  });
}

async function signedRequest(
  url: string,
  tokens: StoredTokens | undefined,
  method: "GET" | "POST" = "GET",
): Promise<string> {
  const client = oauth();
  const requestData = { url, method };
  const token = tokens
    ? { key: tokens.oauthToken, secret: tokens.oauthTokenSecret }
    : undefined;
  const headers = client.toHeader(client.authorize(requestData, token));
  const res = await fetch(url, { method, headers: { ...headers, Accept: "application/json" } });
  const body = await res.text();
  if (!res.ok) {
    throw new EtradeAuthError(`E*TRADE ${method} ${url} failed (${res.status}): ${body.slice(0, 400)}`);
  }
  return body;
}

function parseForm(body: string): Record<string, string> {
  return Object.fromEntries(
    body.split("&").map((pair) => {
      const [k, v] = pair.split("=");
      return [decodeURIComponent(k), decodeURIComponent(v ?? "")];
    }),
  );
}

export async function requestAuthorizeUrl(): Promise<{ authorizeUrl: string; requestToken: string; requestTokenSecret: string }> {
  const url = `${config.etrade.baseUrl}/oauth/request_token?oauth_callback=oob`;
  const body = await signedRequest(url, undefined, "POST");
  const parsed = parseForm(body);
  const requestToken = parsed.oauth_token;
  const requestTokenSecret = parsed.oauth_token_secret;
  if (!requestToken || !requestTokenSecret) {
    throw new EtradeAuthError(`Unexpected request-token response: ${body}`);
  }
  const authorizeUrl = `https://us.etrade.com/e/t/etws/authorize?key=${encodeURIComponent(config.etrade.consumerKey)}&token=${encodeURIComponent(requestToken)}`;
  return { authorizeUrl, requestToken, requestTokenSecret };
}

export async function exchangeVerifier(params: {
  requestToken: string;
  requestTokenSecret: string;
  verifier: string;
}): Promise<StoredTokens> {
  const url = `${config.etrade.baseUrl}/oauth/access_token?oauth_verifier=${encodeURIComponent(params.verifier)}`;
  const body = await signedRequest(
    url,
    { oauthToken: params.requestToken, oauthTokenSecret: params.requestTokenSecret },
    "POST",
  );
  const parsed = parseForm(body);
  const tokens: StoredTokens = {
    oauthToken: parsed.oauth_token,
    oauthTokenSecret: parsed.oauth_token_secret,
  };
  if (!tokens.oauthToken || !tokens.oauthTokenSecret) {
    throw new EtradeAuthError(`Unexpected access-token response: ${body}`);
  }
  store.writeTokens(tokens);
  return tokens;
}

export async function etradeGet<T>(path: string): Promise<T | null> {
  const tokens = store.readTokens();
  if (!tokens?.oauthToken || !tokens.oauthTokenSecret) {
    throw new EtradeAuthError("Not connected to E*TRADE. Complete OAuth first.");
  }
  const url = `${config.etrade.baseUrl}${path}`;
  const body = await signedRequest(url, tokens, "GET");
  if (!body.trim()) {
    return null;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new EtradeAuthError(`E*TRADE ${path} was not JSON: ${body.slice(0, 300)}`);
  }
}
