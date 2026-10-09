import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DIR } from '../playwright.config';
import { ADMIN_PASSWORD, DEFAULT_PASSWORD, signIn } from './support';

/**
 * The first-time workflow on a brand-new install, end to end:
 * seeded default admin -> forced password change -> first real use (account, import, holdings)
 * -> a second, non-admin user. Scenarios run in order and share one database.
 *
 * The last test is an audit: the whole run must have produced no uncaught page errors, no
 * unexpected console errors or HTTP 4xx/5xx, and no errors in the backend or dev-server logs.
 */

const NEW_PASSWORD = ADMIN_PASSWORD;
const SAMPLE_CSV = path.resolve(__dirname, '../../seed/sample/robinhood_app_positions.csv'); // robinhood-positions

// Non-2xx responses the scenarios provoke on purpose. Anything else is a failure.
const EXPECTED_ERROR_RESPONSES: { status: number; url: RegExp; why: string }[] = [
  { status: 401, url: /\/api\/auth\/me$/, why: 'anonymous page load asks who is signed in' },
  { status: 401, url: /\/api\/auth\/login$/, why: 'deliberate wrong-password attempts' },
  {
    status: 400,
    url: /\/api\/auth\/change-password$/,
    why: 'deliberate rejected password changes',
  },
];

const problems: string[] = [];

function watch(page: Page, who: string): void {
  page.on('pageerror', (e) => problems.push(`[${who}] uncaught exception: ${e.message}`));
  page.on('console', (m) => {
    // The browser echoes every failed request as "Failed to load resource"; those are judged
    // (against the allow-list above) from the response event instead.
    if (
      (m.type() === 'error' || m.type() === 'warning') &&
      !m.text().startsWith('Failed to load resource')
    ) {
      problems.push(`[${who}] console.${m.type()}: ${m.text()}`);
    }
  });
  page.on('response', (r: Response) => {
    const expected = EXPECTED_ERROR_RESPONSES.some(
      (e) => e.status === r.status() && e.url.test(r.url()),
    );
    if (r.status() >= 400 && !expected)
      problems.push(`[${who}] unexpected ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED')
      problems.push(`[${who}] request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
}

// Web-first: retries until the nav has rendered (reading the text straight after a click raced).
const expectSettingsLinks = (page: Page, expected: string[]) =>
  expect(page.locator('nav[aria-label="Settings"] a')).toHaveText(expected);

test.describe.configure({ mode: 'serial' });

test.describe('first-time login on a fresh install', () => {
  let adminCtx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    adminCtx = await browser.newContext();
    page = await adminCtx.newPage();
    watch(page, 'admin');
  });
  test.afterAll(async () => adminCtx?.close());

  test('an anonymous visitor lands on the login page; the old /setup page is gone', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Create the admin account')).toHaveCount(0);
  });

  test('wrong credentials are refused with a clear message', async () => {
    await signIn(page, 'admin', 'not-the-password');
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the default admin can sign in but is sent to change the password', async () => {
    await signIn(page, 'admin', DEFAULT_PASSWORD);
    await expect(page).toHaveURL(/\/settings\/change-password$/);
    await expect(page.getByRole('note')).toContainText('default password');
    await expectSettingsLinks(page, ['Change password']); // nothing else is offered yet
    await expect(page.locator('header nav a')).toHaveText(['Home', 'Watchlists', 'Settings']);
    await expect(page.locator('.who')).toContainText('admin');
  });

  test('until it is changed, the rest of the app is out of reach (UI and API)', async () => {
    for (const url of ['/home', '/settings/accounts', '/settings/user-setup', '/holdings']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/settings\/change-password$/);
    }
    const api = await page.request.get('/api/accounts');
    expect(api.status()).toBe(403);
    expect(await api.json()).toEqual({ detail: 'Password change required' });
    expect((await page.request.get('/api/auth/me')).status()).toBe(200); // the account itself is fine
  });

  test('bad password changes are rejected without losing the forced state', async () => {
    const current = page.getByLabel('Current password');
    const next = page.getByLabel('New password', { exact: true });
    const confirm = page.getByLabel('Confirm new password');
    const submit = page.getByRole('button', { name: 'Change password' });

    await current.fill('wrong-current-password');
    await next.fill(NEW_PASSWORD);
    await confirm.fill(NEW_PASSWORD);
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('Current password is incorrect');

    await current.fill(DEFAULT_PASSWORD);
    await confirm.fill('something-else-entirely');
    await expect(page.getByRole('alert').filter({ hasText: "don't match" })).toBeVisible(); // the stale server error may still show beside it
    await expect(submit).toBeDisabled();

    await next.fill(DEFAULT_PASSWORD); // reusing the default is refused by the server
    await confirm.fill(DEFAULT_PASSWORD);
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('different');
    await expect(page).toHaveURL(/\/settings\/change-password$/);
  });

  test('a valid change unlocks the app and lands on Home', async () => {
    await page.getByLabel('Current password').fill(DEFAULT_PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await expect(page.getByText('No accounts yet')).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await expectSettingsLinks(page, ['Accounts', 'User setup', 'Change password']);
  });

  test('the default password no longer works; the new one does and is not forced again', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, 'admin', DEFAULT_PASSWORD);
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');

    await signIn(page, 'admin', NEW_PASSWORD);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('note').filter({ hasText: 'default password' })).toHaveCount(0);
  });

  test('first real use: add an account, import a CSV, see the holdings on Home', async () => {
    await page.goto('/settings/accounts');
    await page.getByLabel('Platform').fill('robinhood');
    await page.getByLabel('Nickname').fill('E2E Robinhood');
    await page.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByText('no holdings yet')).toBeVisible();

    await page.getByRole('link', { name: 'Import' }).click();
    await expect(page).toHaveURL(/\/settings\/accounts\/\d+\/import$/);
    await expect(page.getByLabel('Format')).toHaveValue('robinhood-activity'); // the default
    await page.getByLabel('Format').selectOption('robinhood-positions');
    await page.locator('input[type=file]').setInputFiles(SAMPLE_CSV);
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('3 valid row(s)')).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Imported 3 position(s)');

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.locator('tbody tr strong')).toHaveText(['ORCL', 'DIS', 'INTC']); // by value, largest first
    await expect(page.locator('.tile', { hasText: 'Total value' })).toContainText('$12,050.00');
    await expect(page.getByRole('note')).toContainText('FINNHUB_API_KEY is not set'); // offline run, imported values
    await expect(page.getByRole('checkbox', { name: 'E2E Robinhood' })).toBeChecked();
  });

  test('the admin creates a second user, who is not an admin and sees none of the admin data', async ({
    browser,
  }) => {
    await page.goto('/settings/user-setup');
    await page.getByLabel('Username').fill('carol');
    await page.getByLabel('Temporary password').fill('carol-temporary-1');
    await page.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByRole('status')).toContainText('Created carol.');
    await expect(page.locator('li', { hasText: 'carol' })).toContainText('must set a new password');

    const ctx = await browser.newContext(); // a separate browser profile
    const carol = await ctx.newPage();
    watch(carol, 'carol');
    await carol.goto('/login');
    await signIn(carol, 'carol', 'carol-temporary-1');
    await expect(carol).toHaveURL(/\/settings\/change-password$/); // an admin-set password is only temporary
    await carol.getByLabel('Current password').fill('carol-temporary-1');
    await carol.getByLabel('New password', { exact: true }).fill('carol-password-1');
    await carol.getByLabel('Confirm new password').fill('carol-password-1');
    await carol.getByRole('button', { name: 'Change password' }).click();
    await expect(carol).toHaveURL(/\/home$/);
    await expect(carol.getByText('No accounts yet')).toBeVisible(); // isolation from the admin's account

    await carol.getByRole('link', { name: 'Settings' }).click();
    await expectSettingsLinks(carol, ['Accounts', 'Change password']);
    await carol.goto('/settings/user-setup');
    await expect(carol).toHaveURL(/\/home$/);
    expect((await carol.request.get('/api/users')).status()).toBe(403);
    await ctx.close();
  });

  test('audit: no browser errors, no unexpected HTTP errors, clean backend and dev-server logs', async () => {
    expect(problems, `problems seen by the browser:\n${problems.join('\n')}`).toEqual([]);

    const backend = fs.readFileSync(`${E2E_DIR}/backend.log`, 'utf8');
    expect(backend).toContain('Application startup complete');
    expect(
      backend.match(/Created default admin 'admin'/g),
      'default admin seeded exactly once',
    ).toHaveLength(1);
    expect(backend, 'backend errors').not.toMatch(/Traceback|\bERROR\b|\bCRITICAL\b|Exception/);
    expect(backend, 'backend 5xx responses').not.toMatch(/HTTP\/1\.1" 5\d\d/);

    const frontend = fs.readFileSync(`${E2E_DIR}/frontend.log`, 'utf8');
    expect(frontend).toContain('Application bundle generation complete');
    expect(frontend, 'dev-server errors').not.toMatch(/\[ERROR\]|✘|\bNG\d{4}\b|Error:/);
  });
});
