import { HttpErrorResponse } from '@angular/common/http';

export const STALE_SERVER = "This server doesn't know this request. The backend may be older than the app: restart it.";

/** Turn an API error into a short message for the UI. FastAPI sends {detail: string | [{msg}]}. */
export function apiError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server';
    const d = err.error?.detail;
    // FastAPI's own answer for an unknown route; every 404 the app raises has a specific detail.
    // Seen when the backend process predates the endpoint the UI is calling.
    if (err.status === 404 && d === 'Not Found') return STALE_SERVER;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, '');
    // Unhandled server crash: FastAPI answers with a plain-text "Internal Server Error", no {detail}.
    if (err.status >= 500) return `Server error (HTTP ${err.status}). Check the backend logs.`;
  }
  return fallback;
}
