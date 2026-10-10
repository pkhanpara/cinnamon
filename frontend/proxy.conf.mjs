// Dev-server proxy for `npm start`. The backend port defaults to uvicorn's 8000; set
// CINNAMON_BACKEND_PORT when that port is taken (e.g. `CINNAMON_BACKEND_PORT=8010 npm start`).
const port = process.env.CINNAMON_BACKEND_PORT || '8000';
if (!/^\d+$/.test(port)) {
  throw new Error(`CINNAMON_BACKEND_PORT must be a port number, got "${port}"`);
}

export default { '/api': { target: `http://localhost:${port}`, secure: false } };
