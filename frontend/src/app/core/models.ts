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
