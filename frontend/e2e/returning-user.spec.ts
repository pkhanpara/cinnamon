import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DIR } from '../playwright.config';
import { adminSession, signIn } from './support';

/**
 * Day-to-day workflows for an established (non-admin) user. Self-contained: it provisions its own
 * user through the API, so it passes alone or after first-login.spec.ts.
 */

const USER = 'dave';
const TEMP_PASSWORD = 'dave-temporary-1';
const PASSWORD = 'dave-password-1';
const NEW_PASSWORD = 'dave-password-2';
const FIRST_CSV = path.resolve(__dirname, '../../seed/sample/robinhood_positions.csv'); // ORCL, INTC, DIS
const SECOND_CSV = `${E2E_DIR}/second-snapshot.csv`; // a different, smaller snapshot

test.describe.configure({ mode: 'serial' });

test.describe('a returning user', () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await adminSession(admin);
    const created = await admin.post('/api/users', {
      data: { username: USER, password: TEMP_PASSWORD },
    });
    expect(created.status(), 'user is created (fresh database per run)').toBe(201);
    await admin.dispose();
    // An admin-set password is temporary: take the forced change out of the way via the API.
    const dave = await playwright.request.newContext({ baseURL });
    expect(
      (
        await dave.post('/api/auth/login', { data: { username: USER, password: TEMP_PASSWORD } })
      ).ok(),
    ).toBeTruthy();
    const changed = await dave.post('/api/auth/change-password', {
      data: { current_password: TEMP_PASSWORD, new_password: PASSWORD },
    });
    expect(changed.ok()).toBeTruthy();
    await dave.dispose();

    fs.writeFileSync(
      SECOND_CSV,
      'symbol,name,quantity,cost_basis,market_value,price_used,as_of\n' +
        'VTI,Vanguard Total Stock Market ETF,10,2000.00,2700.00,270.00,2026-02-01T00:00:00Z\n',
    );
    ctx = await browser.newContext();
    page = await ctx.newPage();
  });
  test.afterAll(async () => ctx?.close());

  test('signs in, and the session survives a reload and a deep link', async () => {
    await page.goto('/login');
    await signIn(page, USER, PASSWORD);
    await expect(page).toHaveURL(/\/home$/);
    await page.reload();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto('/settings/accounts');
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await page.goto('/login'); // already signed in: the login page bounces to the app
    await expect(page).toHaveURL(/\/home$/);
  });

  test('importing a second snapshot replaces the first', async () => {
    await page.goto('/settings/accounts');
    await page.getByLabel('Platform').fill('robinhood');
    await page.getByLabel('Nickname').fill('Dave Brokerage');
    await page.getByRole('button', { name: 'Add account' }).click();

    for (const [file, button, summary] of [
      [FIRST_CSV, 'Import', 'Imported 3 position(s)'],
      [SECOND_CSV, 'Replace 3 position(s) and import', 'Imported 1 position(s)'], // warns what it will discard
    ] as const) {
      await page.goto('/settings/accounts');
      await page.getByRole('link', { name: 'Import' }).click();
      await page.getByLabel('Format').selectOption('snapshot'); // not the robinhood default
      await page.locator('input[type=file]').setInputFiles(file);
      await page.getByRole('button', { name: 'Preview' }).click();
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(page.getByRole('status')).toContainText(summary);
    }

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.locator('tbody tr strong')).toHaveText(['VTI']); // the old three are gone
    await expect(page.locator('.tile', { hasText: 'Total value' })).toContainText('$2,700.00');
  });

  test('deleting the account removes its holdings', async () => {
    await page.goto('/settings/accounts');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Dave Brokerage')).toHaveCount(0);
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByText('No accounts yet')).toBeVisible();
  });

  test('changing the password signs out the other devices', async ({ browser }) => {
    const other = await browser.newContext(); // "the phone"
    const phone = await other.newPage();
    await phone.goto('/login');
    await signIn(phone, USER, PASSWORD);
    await expect(phone).toHaveURL(/\/home$/);

    await page.goto('/settings/change-password');
    await expect(page.getByRole('note')).toHaveCount(0); // voluntary change: no "default password" banner
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('status')).toHaveText('Password changed.');

    expect((await page.request.get('/api/auth/me')).status()).toBe(200); // this device stays in
    expect((await phone.request.get('/api/auth/me')).status()).toBe(401); // the other one does not
    await phone.goto('/home');
    await expect(phone).toHaveURL(/\/login$/);
    await other.close();
  });

  test('signing out ends the session; the old password is dead, the new one works', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/accounts')).status()).toBe(401);
    await page.goto('/settings/accounts');
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, USER, PASSWORD);
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await signIn(page, USER, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/home$/);
  });
});
