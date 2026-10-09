export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
}

export interface Account {
  id: number;
  platform: string;
  nickname: string;
  created_at: string;
  position_count: number;
  last_import_at: string | null;
}

export interface Connector {
  slug: string;
  label: string;
  description: string;
}

/** Decimals arrive as strings so no precision is lost; convert only for display. */
export interface Position {
  symbol: string;
  name: string | null;
  quantity: string;
  cost_basis: string;
  market_value: string | null;
  price: string | null;
  as_of: string | null;
}

export interface ImportPreview {
  connector: string;
  filename: string;
  rows: Position[];
  errors: { row: number; message: string }[];
  warnings: string[];
  current_position_count: number;
  total_cost_basis: string;
  total_market_value: string | null;
}

export interface ImportResult {
  id: number;
  connector: string;
  filename: string;
  row_count: number;
  created_at: string;
}

export type PriceSource = 'live' | 'stale' | 'file' | 'none';

export interface HoldingLine {
  account_id: number;
  account_nickname: string;
  platform: string;
  quantity: string;
  cost_basis: string;
  value: string | null;
  source: PriceSource;
}

export interface Holding {
  symbol: string;
  name: string | null;
  quantity: string;
  cost_basis: string;
  price: string | null;
  source: PriceSource;
  value: string | null;
  gain: string | null;
  gain_pct: string | null;
  weight_pct: string | null;
  day_change: string | null;
  day_change_pct: string | null;
  lines: HoldingLine[];
}

export interface HoldingsSummary {
  total_value: string;
  total_cost_basis: string;
  gain: string;
  gain_pct: string | null;
  day_change: string | null;
  day_change_pct: string | null;
  live_count: number;
  stale_count: number;
  file_count: number;
  unpriced_count: number;
}

export interface HoldingsResponse {
  account_ids: number[];
  summary: HoldingsSummary;
  holdings: Holding[];
  warnings: string[];
  prices_as_of: string | null;
}

// ---- symbol detail ----

export interface SymbolQuote {
  price: string;
  prev_close: string | null;
  change: string | null;
  change_pct: string | null;
  as_of: string;
  stale: boolean;
}

export interface SymbolProfile {
  name: string | null;
  exchange: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  web_url: string | null;
  market_cap: string | null;
}

export interface SymbolStats {
  week52_high: string | null;
  week52_low: string | null;
  avg_volume_10d: string | null;
  avg_volume_3m: string | null;
}

export interface SymbolOverview {
  symbol: string;
  name: string | null;
  quote: SymbolQuote | null;
  profile: SymbolProfile | null;
  stats: SymbolStats | null;
  position: Holding | null;
  warnings: string[];
}

export type HistoryRange = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | 'all';

export interface Bar {
  t: number; // UTC epoch seconds
  d: string; // trading date (exchange time zone), YYYY-MM-DD
  o: string;
  h: string;
  l: string;
  c: string;
  v: number;
}

export interface HistoryResponse {
  symbol: string;
  range: HistoryRange;
  intraday: boolean;
  bars: Bar[];
  stale: boolean;
  as_of: string;
}

export interface PortfolioPoint {
  t: number; // UTC epoch seconds
  d: string; // YYYY-MM-DD
  value: string;
  spy_value: string | null; // SPY rebased to the portfolio's first value
}

export interface PortfolioHistory {
  basis: 'backcast'; // today's quantities x past prices (ADR 0010)
  range: HistoryRange;
  intraday: boolean;
  points: PortfolioPoint[];
  start_value: string | null;
  end_value: string | null;
  change: string | null;
  change_pct: string | null;
  spy: { change_pct: string | null; difference_pp: string | null } | null;
  symbols: string[];
  covered_value_pct: string | null;
  warnings: string[];
  stale: boolean;
  as_of: string | null;
}

export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
}

export interface NewsResponse {
  items: NewsItem[];
  stale: boolean;
  as_of: string;
}

export interface SearchHit {
  symbol: string;
  description: string;
  type: string;
}

// ---- watchlists and investing principles (ADR 0012) ----

export interface Watchlist {
  id: number;
  name: string;
  created_at: string;
  symbols: string[];
}

export interface WatchlistDetail {
  id: number;
  name: string;
  created_at: string;
  items: { symbol: string; added_at: string }[];
}

export type Verdict = 'pass' | 'fail' | 'unsure';
export type PrincipleStatus = 'pass' | 'fail' | 'warn' | 'info' | 'na' | 'manual';

export interface PrincipleCheck {
  verdict: Verdict;
  note: string;
  updated_at: string;
}

export interface Principle {
  key: string;
  label: string;
  description: string;
  kind: 'computed' | 'manual';
  rule: string;
  unit: 'pct' | 'ratio' | 'usd' | null;
  better: 'lower' | 'higher' | null;
  value: string | null;
  status: PrincipleStatus;
  note: string;
  years: number | null;
  check: PrincipleCheck | null; // the user's verdict; overrides `status` when set
}

export interface InsiderTrade {
  name: string;
  shares_change: number;
  price: string | null;
  code: string;
  transaction_date: string;
  filing_date: string | null;
}

export interface BuybackYear {
  year: number;
  amount: string;
  avg_price: string | null;
  high_5y: string | null;
  near_high: boolean;
}

export interface CashYear {
  year: number;
  net_income: string | null;
  owner_earnings: string | null;
  cfo: string | null;
  cff: string | null;
  acquisitions: string | null;
  buybacks: string | null;
  rnd: string | null;
  revenue: string | null;
}

export interface Evidence {
  insider_trades: InsiderTrade[];
  insider_net_value: string | null;
  buybacks: BuybackYear[];
  years: CashYear[];
  splits: { date: string; ratio: string }[];
}

export interface Scorecard {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  applicable: boolean;
  principles: Principle[];
  evidence: Evidence | null;
  warnings: string[];
  as_of: string | null;
  stale: boolean;
}

export interface PeerStat {
  key: string;
  mean: string | null;
  median: string | null;
  n: number;
}

export interface Peers {
  symbol: string;
  peers: { symbol: string; name: string | null }[];
  failed: string[];
  stats: PeerStat[];
  stale: boolean;
}
