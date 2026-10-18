# Options risk

Risk view for an options book, computed from the **last known position snapshot**. Live E*TRADE calls update that snapshot; the risk engine never depends on a live request succeeding.

```
apps/web          TypeScript React client
apps/api          TypeScript Fastify server
  agents/market-data   positions + quotes → snapshot
  agents/risk          Greeks / $delta from snapshot
  agents/screener      1σ 10-wide put credits, IV, RSI, 200D SMA
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

## Screener

The screener is a separate agent from risk. It does not read the position snapshot. It scores a watchlist of underlyings (currently NBIS, APP, DRAM, SKHY, MNDY, HUBS, INTU, DXYZ, AVGO, SMH, TEAM) and the table defaults to **highest Options ROI % first**.

| Column | Meaning |
| --- | --- |
| Options ROI % | Dollar credit on the 10-wide 1σ put spread ÷ $1000 |
| Last / Change % | Equity last vs previous close |
| RSI | 14-period Wilder RSI on daily closes |
| 200D SMA | Simple moving average of the last 200 daily closes |
| LastVs200D | `(last − 200D SMA) / 200D SMA` |
| Spread | `(short strike, long strike)` — always 10 points wide |
| Implied Vol | IV of the short put (~30 DTE, nearest 1σ OTM) |

**Spread and ROI**

1. Take the expiry closest to 30 days.
2. Estimate 1σ down as `spot × (1 − ATM put IV × √(DTE/365))`.
3. Pick the listed 10-wide put credit whose short strike is closest to that 1σ level.
4. Credit is `short last − long last` from the option chain (not mid).
5. ROI % is `(credit × 100) / 1000`.

Equity quotes, expirations, chains, and option last/IV come from E*TRADE. RSI and the 200-day SMA come from daily closes (Yahoo chart). Names without 200 sessions show a blank 200D SMA / LastVs200D.

`MOCK_MODE=true` returns sample screener rows so the table still renders without OAuth.

## Later agents

Keep HTTP handlers thin. New agents should consume `PositionSnapshot` / `Quote` from `packages/shared` rather than calling E*TRADE directly.
