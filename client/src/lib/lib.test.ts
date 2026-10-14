import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage, setUnauthorizedHandler, toQuery } from './api';
import { formatBytes, formatRating, formatRelative, plural, toLocalInputValue } from './format';
import { sanitiseLine } from '@/room/runSandbox';

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('sends JSON with the session cookie and returns the parsed body', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.post('/exchanges', { a: 1 })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/exchanges');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('turns API errors into ApiError with field messages', async () => {
    vi.stubGlobal(
      'fetch',
      respond(400, {
        error: {
          code: 'validation_failed',
          message: 'Some fields need attention.',
          fields: { email: 'Bad' },
        },
      }),
    );
    const error = await api.post('/auth/register', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_failed',
      fields: { email: 'Bad' },
    });
    expect(errorMessage(error)).toBe('Some fields need attention.');
  });

  it('signs the member out locally when a request finds the session expired', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      'fetch',
      respond(401, { error: { code: 'unauthorized', message: 'Please sign in to continue.' } }),
    );
    await expect(api.get('/dashboard')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();

    // A wrong password is also a 401, but it is not an expired session.
    vi.stubGlobal(
      'fetch',
      respond(401, { error: { code: 'invalid_credentials', message: 'Incorrect.' } }),
    );
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('explains network failures and never shows raw errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await api.get('/sessions').catch((e: unknown) => e);
    expect(errorMessage(error)).toMatch(/could not reach SkillSwap/);
    expect(errorMessage(new Error('ECONNRESET at internal/stream'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('handles empty responses and builds query strings from set values only', async () => {
    vi.stubGlobal('fetch', respond(204, null));
    await expect(api.delete('/sessions/1/files/2')).resolves.toBeUndefined();
    expect(toQuery({ q: 'java', page: 2, onlineOnly: false, day: '', sort: undefined })).toBe(
      '?q=java&page=2',
    );
    expect(toQuery({})).toBe('');
  });
});

describe('formatting', () => {
  it('describes times relative to now', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(formatRelative('2026-10-11T15:00:00Z', now)).toBe('in 3 hours');
    expect(formatRelative('2026-10-10T12:00:00Z', now)).toBe('yesterday');
    expect(formatRelative('2026-10-11T11:59:40Z', now)).toBe('just now');
  });

  it('formats sizes, ratings and counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(81014)).toBe('79.1 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatRating(null)).toBe('No reviews yet');
    expect(formatRating(5)).toBe('5.0');
    expect(plural(1, 'session')).toBe('1 session');
    expect(plural(4, 'session')).toBe('4 sessions');
  });

  it('produces local values for date-time inputs', () => {
    expect(toLocalInputValue(new Date(2026, 9, 5, 9, 7))).toBe('2026-10-05T09:07');
  });
});

describe('sandbox output', () => {
  it('accepts only well-formed lines and caps their length', () => {
    expect(sanitiseLine({ level: 'log', text: 'hi' })).toEqual({ level: 'log', text: 'hi' });
    expect(sanitiseLine({ level: 'system', text: 'spoofed' })).toBeNull();
    expect(sanitiseLine({ level: 'log', text: 42 })).toBeNull();
    expect(sanitiseLine('nope')).toBeNull();
    expect(sanitiseLine({ level: 'error', text: 'x'.repeat(5000) })?.text.length).toBe(2001);
  });
});
