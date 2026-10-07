import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const DEFAULT_PASSWORD = '$admin123456';
export const ADMIN_PASSWORD = 'my-own-new-password';

/**
 * Signs the request context in as the admin whatever state the shared database is in: a fresh
 * install (default password, forced change) or one an earlier spec already moved on.
 */
export async function adminSession(request: APIRequestContext): Promise<void> {
  const own = await request.post('/api/auth/login', { data: { username: 'admin', password: ADMIN_PASSWORD } });
  if (own.ok()) return;
  const first = await request.post('/api/auth/login', { data: { username: 'admin', password: DEFAULT_PASSWORD } });
  expect(first.ok(), 'admin can sign in with the default or the e2e password').toBeTruthy();
  const changed = await request.post('/api/auth/change-password', {
    data: { current_password: DEFAULT_PASSWORD, new_password: ADMIN_PASSWORD },
  });
  expect(changed.ok()).toBeTruthy();
  // Changing the password revokes sessions; sign in again with the new one.
  expect((await request.post('/api/auth/login', { data: { username: 'admin', password: ADMIN_PASSWORD } })).ok()).toBeTruthy();
}

export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
