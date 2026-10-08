// Dev-server proxy for the e2e stack. playwright.config.ts passes the resolved backend port, so
// the target always follows CINNAMON_E2E_BACKEND_PORT; there is deliberately no default here.
const port = process.env.CINNAMON_E2E_BACKEND_PORT;
if (!port) {
  throw new Error('CINNAMON_E2E_BACKEND_PORT is not set; start the e2e stack with `npm run e2e`');
}

export default { '/api': { target: `http://localhost:${port}`, secure: false } };
