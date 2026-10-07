export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
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
