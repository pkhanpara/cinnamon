import { HttpErrorResponse } from '@angular/common/http';

/** Turn an API error into a short message for the UI. FastAPI sends {detail: string | [{msg}]}. */
export function apiError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server';
    const d = err.error?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, '');
    // Unhandled server crash: FastAPI answers with a plain-text "Internal Server Error", no {detail}.
    if (err.status >= 500) return `Server error (HTTP ${err.status}). Check the backend logs.`;
  }
  return fallback;
}
