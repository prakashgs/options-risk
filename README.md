# Options risk

Risk view for an options book, computed from the **last known position snapshot**. Live E*TRADE calls update that snapshot; the risk engine never depends on a live request succeeding.

```
apps/web          TypeScript React client
apps/api          TypeScript Fastify server
  agents/market-data   positions + quotes → snapshot
  agents/risk          Greeks / $delta from snapshot
  agents/screener      reserved; not mixed into risk
  integrations/etrade  OAuth 1.0a + REST
packages/shared   shared types (the contract between future agents)
```

## Run

Needs Node 20+. This machine did not have Node or Xcode CLT when the project was created.

```bash
cp .env.example .env
npm install
npm run dev
```

- Client: http://localhost:5173
- API: http://127.0.0.1:8787

`MOCK_MODE=true` (default) loads a sample book so you can use the dashboard before E*TRADE access.

## E*TRADE

1. Create an app at [developer.etrade.com](https://developer.etrade.com).
2. Put the consumer key and secret in `.env`.
3. Start with sandbox (`ETRADE_BASE_URL=https://apisb.etrade.com`), then production (`https://api.etrade.com`).
4. Set `MOCK_MODE=false`, restart the API, use **Start E*TRADE login**, authorize, paste the verifier.

Refresh then:

1. Lists accounts
2. Pulls portfolio for the first account
3. Quotes every symbol and underlying (batches of 25)
4. Writes `data/last-snapshot.json`
5. Risk reads only that file

Tokens are stored in `data/etrade-tokens.json` (gitignored).

## Later agents

Keep HTTP handlers thin. New agents should consume `PositionSnapshot` / `Quote` from `packages/shared` rather than calling E*TRADE directly.
