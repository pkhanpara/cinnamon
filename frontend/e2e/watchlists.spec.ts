import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { adminSession, signIn } from './support';

/**
 * Watchlists (ADR 0012). Self-contained: provisions its own user through the API. The e2e stack runs
 * without a Finnhub key, so scorecards answer 503 and the page must say a key is needed rather than
 * break; the scoring itself is covered by the backend and component tests.
 */

const USER = 'erin';
const TEMP_PASSWORD = 'erin-temporary-1';
const PASSWORD = 'erin-password-1';

test.describe.configure({ mode: 'serial' });

test.describe('watchlists', () => {
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
    const erin = await playwright.request.newContext({ baseURL });
    expect(
      (
        await erin.post('/api/auth/login', { data: { username: USER, password: TEMP_PASSWORD } })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await erin.post('/api/auth/change-password', {
          data: { current_password: TEMP_PASSWORD, new_password: PASSWORD },
        })
      ).ok(),
    ).toBeTruthy();
    await erin.dispose();

    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto('/login');
    await signIn(page, USER, PASSWORD);
    await expect(page).toHaveURL(/\/home$/);
  });

  test.afterAll(async () => ctx?.close());

  test('creates a watchlist from the nav', async () => {
    await page.getByRole('link', { name: 'Watchlists' }).click();
    await expect(page.getByText('No watchlists yet.')).toBeVisible();
    await page.getByLabel('Name').fill('Deep value');
    await page.getByRole('button', { name: 'Create watchlist' }).click();
    await expect(page).toHaveURL(/\/watchlists\/\d+$/);
    await expect(page.getByRole('heading', { name: 'Deep value' })).toBeVisible();
  });

  test('adds symbols; without an API key the rows say so instead of breaking', async () => {
    const shown: string[] = [];
    for (const symbol of ['jnj', 'KO']) {
      await page.getByLabel('Symbol to add').fill(symbol);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      shown.push(symbol.toUpperCase());
      await expect(page.locator('tbody a.sym')).toHaveText(shown);
    }
    await expect(page.locator('tbody a.sym')).toHaveText(['JNJ', 'KO']);
    await expect(page.getByText('Scores need a Finnhub API key')).toBeVisible();
    await expect(page.getByText('No score without an API key.')).toHaveCount(2);
  });

  test('the list survives a reload and shows on the overview', async () => {
    await page.reload();
    await expect(page.locator('tbody a.sym')).toHaveText(['JNJ', 'KO']);
    await page.getByRole('link', { name: '← Watchlists' }).click();
    await expect(page.getByRole('listitem')).toContainText(['Deep value']);
    await expect(page.getByText('2 symbols')).toBeVisible();
    await expect(page.locator('.lists .tag')).toHaveText(['JNJ', 'KO']);
    await page.getByRole('link', { name: 'Deep value' }).click();
  });

  test('removes a symbol, renames and deletes the list', async () => {
    await page.getByRole('button', { name: 'Remove JNJ' }).click();
    await expect(page.locator('tbody a.sym')).toHaveText(['KO']);

    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Watchlist name').fill('Value ideas');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Value ideas' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click(); // in-app confirm
    await expect(page).toHaveURL(/\/watchlists$/);
    await expect(page.getByText('No watchlists yet.')).toBeVisible();
  });
});
