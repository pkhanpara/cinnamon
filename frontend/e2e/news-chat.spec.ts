import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { LLM_PORT } from '../playwright.config';
import { ADMIN_PASSWORD, adminSession, seedQuote, signIn } from './support';

/**
 * Ask AI happy path (ADR 0008, 0015), with nothing mocked in the browser: UI -> backend (quote lookup,
 * prompt, SSE relay) -> e2e/fake-llm.mjs, which streams a fixed markdown answer salted with a
 * javascript: link and a <script>. Without a Finnhub key a symbol has no quote or news and the chat
 * refuses (409), so the spec seeds a quote for a ticker no other spec uses.
 */

const SYMBOL = 'CNMN';

test.describe.configure({ mode: 'serial' });

test.describe('Ask AI chat', () => {
  let ctx: BrowserContext;
  let page: Page;
  const problems: string[] = [];

  test.beforeAll(async ({ browser, playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await adminSession(admin); // whatever state earlier specs left the admin in
    await admin.dispose();
    seedQuote(SYMBOL, '105.50', '100.00');

    ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`uncaught exception: ${e.message}`));
    page.on('console', (m) => {
      // Failed requests are echoed as "Failed to load resource"; without a Finnhub key the symbol
      // page gets expected 503s (news, search), so responses are judged below, for the chat only.
      if (
        (m.type() === 'error' || m.type() === 'warning') &&
        !m.text().startsWith('Failed to load resource')
      )
        problems.push(`console: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/llm/'))
        problems.push(`unexpected ${r.status()} ${r.url()}`);
    });
    await page.goto('/login');
    await signIn(page, 'admin', ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/home$/);
  });

  test.afterAll(async () => ctx?.close());

  test('a preset streams a sanitized markdown answer from the model', async () => {
    await page.goto(`/symbol/${SYMBOL}`);
    await page.getByRole('button', { name: 'Ask AI' }).click();
    const panel = page.getByRole('complementary', { name: 'Ask AI' });
    await expect(panel).toContainText('Model: fake-llm');

    await panel.getByRole('button', { name: 'What are the risks?' }).click();
    const answer = panel.locator('.msg:not(.user)').last();
    await expect(answer).toContainText('done.'); // the last chunk arrived
    await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible(); // stream finished

    await expect(answer.locator('li strong')).toHaveText(['Legal', 'Competition']);
    const filing = answer.getByRole('link', { name: 'the filing' });
    await expect(filing).toHaveAttribute('href', 'https://example.com/filing');
    await expect(filing).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(filing).toHaveAttribute('target', '_blank');
    // The javascript: link survives as text only, and the <script> as visible text, never as code.
    const unsafe = answer.locator('a', { hasText: /^this$/ });
    await expect(unsafe).toHaveCount(1);
    await expect(unsafe).not.toHaveAttribute('href', /.*/);
    await expect(answer).toContainText('<script>window.__pwned = true</script>');
    await expect(page.locator('.msg script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();

    // The backend, not the browser, built the prompt: the preset question plus the seeded quote.
    const sent = await (await fetch(`http://localhost:${LLM_PORT}/last-request`)).json();
    const prompt = sent.messages.map((m: { content: string }) => m.content).join('\n');
    expect(prompt).toContain(`What risks or concerns for ${SYMBOL}`);
    expect(prompt).toContain('price 105.50, previous close 100.00');
    expect(prompt).not.toContain("The user's own position"); // not opted in
  });

  test('Copy puts the conversation on the clipboard as markdown', async () => {
    const panel = page.getByRole('complementary', { name: 'Ask AI' });
    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(panel.getByRole('status')).toHaveText('Copied the conversation as markdown.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`# Ask AI: ${SYMBOL}`);
    expect(copied).toContain('**You:** What are the risks?');
    expect(copied).toContain('**AI (fake-llm):** Main risks in the news:');
    expect(copied).toContain('- **Legal**: a pending lawsuit'); // markdown source, not HTML
  });

  test('no browser errors or warnings along the way', () => {
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
