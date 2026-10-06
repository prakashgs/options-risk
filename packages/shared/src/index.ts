export type InstrumentType = "equity" | "option" | "other";
export type OptionType = "CALL" | "PUT";
export type SnapshotSource = "etrade" | "mock";

export interface Position {
  accountIdKey: string;
  symbol: string;
  description: string;
  quantity: number;
  type: InstrumentType;
  underlying?: string;
  expiration?: string;
  strike?: number;
  optionType?: OptionType;
  pricePaid?: number;
  marketValue?: number;
  lastTrade?: number;
}

export interface Quote {
  symbol: string;
  last: number;
  bid?: number;
  ask?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  daysToExpiration?: number;
  asOf: string;
}

export interface PositionSnapshot {
  asOf: string;
  source: SnapshotSource;
  accountIdKey?: string;
  positions: Position[];
  quotes: Quote[];
}

export interface UnderlyingRisk {
  underlying: string;
  netDelta: number;
  dollarDelta: number;
  gamma: number;
  theta: number;
  vega: number;
  marketValue: number;
  positionCount: number;
}

export interface ExpirationRisk {
  expiration: string;
  netDelta: number;
  marketValue: number;
  contracts: number;
}

export interface RiskSummary {
  snapshotAsOf: string;
  computedAt: string;
  source: SnapshotSource;
  netDelta: number;
  dollarDelta: number;
  gamma: number;
  theta: number;
  vega: number;
  marketValue: number;
  byUnderlying: UnderlyingRisk[];
  byExpiration: ExpirationRisk[];
}

export interface AuthStatus {
  connected: boolean;
  mockMode: boolean;
  environment: "sandbox" | "production" | "mock";
  hasConsumerKey: boolean;
}

export interface ScreenerIdea {
  symbol: string;
  thesis: string;
  score: number;
}

export interface ScreenerResult {
  generatedAt: string;
  status: "ready" | "stub";
  ideas: ScreenerIdea[];
  note: string;
}
