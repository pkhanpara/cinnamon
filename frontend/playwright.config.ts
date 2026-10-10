import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a throwaway stack on their own ports (so a running dev server is
 * left alone): a backend started like a real first run (plain uvicorn, empty database, no manual
 * migration), the Angular dev server and a fake OpenAI-compatible model (e2e/fake-llm.mjs) that the
 * backend's Ask AI chat talks to. No Finnhub key is configured, so runs are offline and deterministic
 * (holdings fall back to imported values).
 *
 *   cd frontend && npm run e2e
 *
 * Ports and the work directory can be overridden so several runs (e.g. one per worktree) can go
 * side by side; the dev server's /api proxy (e2e/proxy.e2e.mjs) follows the backend port:
 *
 *   CINNAMON_E2E_BACKEND_PORT=8337 CINNAMON_E2E_FRONTEND_PORT=4337 CINNAMON_E2E_LLM_PORT=8338 \
 *     CINNAMON_E2E_DIR=/tmp/cinnamon-e2e-8337 npm run e2e
 */
function envPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer port from 1024 to 65535, got '${raw}'`);
  }
  return port;
}

/** The work directory is wiped with `rm -rf` every run, so only accept an obviously-ours path. */
function envDir(name: string, fallback: string): string {
  const raw = process.env[name]?.trim() || fallback;
  const dir = path.normalize(raw).replace(/\/$/, ''); // resolve '..' before checking the name
  if (
    !path.isAbsolute(dir) ||
    !/^[\w/.-]+$/.test(dir) ||
    !path.basename(dir).startsWith('cinnamon-e2e')
  ) {
    throw new Error(
      `${name} must be an absolute path of [A-Za-z0-9_./-] whose last segment starts with ` +
        `'cinnamon-e2e' (it is deleted every run), got '${raw}'`,
    );
  }
  return dir;
}

export const E2E_DIR = envDir('CINNAMON_E2E_DIR', '/tmp/cinnamon-e2e');
const BACKEND_PORT = envPort('CINNAMON_E2E_BACKEND_PORT', 8310);
const FRONTEND_PORT = envPort('CINNAMON_E2E_FRONTEND_PORT', 4310);
export const LLM_PORT = envPort('CINNAMON_E2E_LLM_PORT', 8311);
if (new Set([BACKEND_PORT, FRONTEND_PORT, LLM_PORT]).size !== 3) {
  throw new Error(
    'CINNAMON_E2E_BACKEND_PORT, CINNAMON_E2E_FRONTEND_PORT and CINNAMON_E2E_LLM_PORT must differ, ' +
      `got ${BACKEND_PORT}, ${FRONTEND_PORT} and ${LLM_PORT}`,
  );
}

export default defineConfig({
  testDir: './e2e',
  outputDir: `${E2E_DIR}/results`,
  workers: 1, // the scenarios share one database and build on each other
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Fresh directory every run => brand-new database => first-time startup path.
      command:
        `rm -rf ${E2E_DIR} && mkdir -p ${E2E_DIR} && ` +
        `exec uv run uvicorn app.main:app --port ${BACKEND_PORT} > ${E2E_DIR}/backend.log 2>&1`,
      cwd: '../backend',
      env: {
        DATABASE_URL: `sqlite:///${E2E_DIR}/e2e.db`,
        FINNHUB_API_KEY: '',
        LLM_BASE_URL: `http://localhost:${LLM_PORT}/v1`,
        LLM_MODEL: 'fake-llm',
        LLM_API_KEY: '',
      },
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // After the backend, whose command recreates the work dir this log lives in.
      command: `exec node e2e/fake-llm.mjs > ${E2E_DIR}/fake-llm.log 2>&1`,
      env: { CINNAMON_E2E_LLM_PORT: String(LLM_PORT) },
      url: `http://localhost:${LLM_PORT}/health`,
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command:
        `exec npx ng serve --port ${FRONTEND_PORT} --proxy-config e2e/proxy.e2e.mjs ` +
        `> ${E2E_DIR}/frontend.log 2>&1`,
      // The resolved port, so the proxy never falls back to a default of its own.
      env: { CINNAMON_E2E_BACKEND_PORT: String(BACKEND_PORT) },
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
