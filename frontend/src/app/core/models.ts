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
}
