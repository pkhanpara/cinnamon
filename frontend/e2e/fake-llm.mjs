// A stand-in for an OpenAI-compatible /chat/completions server, for the e2e stack (ADR 0015).
// playwright.config.ts starts it and points the backend's LLM_BASE_URL here, so the chat runs the
// real path: UI -> backend prompt + SSE relay -> this server. It streams one fixed markdown answer,
// salted with things the UI must neutralise. GET /last-request returns the body the backend sent,
// so a spec can check the prompt. Like proxy.e2e.mjs there is deliberately no default port.
import http from 'node:http';

const port = Number(process.env.CINNAMON_E2E_LLM_PORT);
if (!port) {
  throw new Error('CINNAMON_E2E_LLM_PORT is not set; start the e2e stack with `npm run e2e`');
}

export const ANSWER_CHUNKS = [
  'Main risks in the news:\n\n',
  '- **Legal**: a pending lawsuit\n',
  '- **Competition**: new entrants\n\n',
  'Read [the filing](https://example.com/filing) or ',
  '[this](javascript:alert(document.cookie)) ',
  '<script>window.__pwned = true</script>done.',
];

let lastRequest = null;

const chunk = (content) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.end('ok');
    if (req.method === 'GET' && req.url === '/last-request') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(lastRequest));
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.statusCode = 404;
      return res.end();
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      lastRequest = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      for (const text of ANSWER_CHUNKS) {
        res.write(chunk(text));
        await new Promise((r) => setTimeout(r, 30)); // arrive in pieces, like a real model
      }
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
    });
  })
  .listen(port, () => console.log(`fake LLM on :${port}`));
