import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DIR } from '../playwright.config';

export const DEFAULT_PASSWORD = '$admin123456';
export const ADMIN_PASSWORD = 'my-own-new-password';

/**
 * Signs the request context in as the admin whatever state the shared database is in: a fresh
 * install (default password, forced change) or one an earlier spec already moved on.
 */
export async function adminSession(request: APIRequestContext): Promise<void> {
  const own = await request.post('/api/auth/login', {
    data: { username: 'admin', password: ADMIN_PASSWORD },
  });
  if (own.ok()) return;
  const first = await request.post('/api/auth/login', {
    data: { username: 'admin', password: DEFAULT_PASSWORD },
  });
  expect(first.ok(), 'admin can sign in with the default or the e2e password').toBeTruthy();
  const changed = await request.post('/api/auth/change-password', {
    data: { current_password: DEFAULT_PASSWORD, new_password: ADMIN_PASSWORD },
  });
  expect(changed.ok()).toBeTruthy();
  // Changing the password revokes sessions; sign in again with the new one.
  expect(
    (
      await request.post('/api/auth/login', {
        data: { username: 'admin', password: ADMIN_PASSWORD },
      })
    ).ok(),
  ).toBeTruthy();
}

export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Upserts a quote into the e2e database through the app's own model (so types are encoded exactly
 * as the app writes them). Without a Finnhub key nothing else can give a symbol a quote, and the
 * Ask AI chat refuses (409) a symbol with neither a quote nor news. */
export function seedQuote(symbol: string, price: string, prevClose: string): void {
  const script = [
    'import sys',
    'from datetime import UTC, datetime',
    'from decimal import Decimal',
    'from app.db import SessionLocal',
    'from app.models import QuoteCache',
    'sym, price, prev = sys.argv[1:4]',
    'with SessionLocal() as db:',
    '    now = datetime.now(UTC)',
    '    db.merge(QuoteCache(symbol=sym, price=Decimal(price), prev_close=Decimal(prev),',
    '                        quote_time=now, fetched_at=now))',
    '    db.commit()',
  ].join('\n');
  execFileSync('uv', ['run', '--quiet', 'python', '-', symbol, price, prevClose], {
    cwd: path.resolve(__dirname, '../../backend'),
    input: script,
    env: { ...process.env, DATABASE_URL: `sqlite:///${E2E_DIR}/e2e.db` },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}
