import { HttpErrorResponse } from '@angular/common/http';
import { apiError } from './errors';

const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('apiError', () => {
  it('uses a string detail', () => {
    expect(apiError(http(409, { detail: 'Setup already completed' }))).toBe('Setup already completed');
  });

  it('uses the first validation message', () => {
    const e = http(422, { detail: [{ msg: 'Value error, too short' }] });
    expect(apiError(e)).toBe('too short');
  });

  it('explains an unreachable server', () => {
    expect(apiError(http(0, null))).toBe('Cannot reach the server');
  });

  it('shows a useful message for a plain-text 500', () => {
    const msg = apiError(http(500, 'Internal Server Error'), 'Setup failed');
    expect(msg).toContain('HTTP 500');
    expect(msg).toContain('backend logs');
  });

  it('falls back for non-HTTP errors', () => {
    expect(apiError(new Error('x'), 'Setup failed')).toBe('Setup failed');
  });
});
