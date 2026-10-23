import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { getUser, saveSession } from './auth';

const user = { id: 1, name: 'Alice', email: 'alice@seatbook.test', role: 'ATTENDEE' as const };
beforeEach(() => { saveSession({ token: 'test-session', user }); });

it('attaches the bearer token and returns successful JSON', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await api('/bookings/1/cancel', { method: 'POST' }, true)).toEqual({ success: true });
  const headers = fetcher.mock.calls[0][1].headers as Headers;
  expect(headers.get('Authorization')).toBe('Bearer test-session');
});

it('clears expired authentication and returns a readable 401 error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in again' } }, { status: 401 })));
  await expect(api('/bookings/mine', {}, true)).rejects.toMatchObject({ status: 401, message: 'Sign in again' });
  expect(getUser()).toBeNull();
});

it('does not report a rejected cancellation as success or clear a valid session', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' } }, { status: 404 })));
  await expect(api('/bookings/1/cancel', { method: 'POST' }, true)).rejects.toBeInstanceOf(ApiError);
  expect(getUser()).toEqual(user);
});

it('retains session B when a delayed request from session A returns 401', async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { respond = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const pending = api('/bookings/mine', {}, true);
  const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
  expect((fetcher.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Bearer test-session');
  const sessionB = { token: 'new-session', user: { ...user, id: 2, name: 'Bob' } };
  saveSession(sessionB);
  respond(Response.json({ error: { message: 'Session A expired' } }, { status: 401 }));
  await rejected;
  expect(localStorage.getItem('token')).toBe(sessionB.token);
  expect(getUser()).toEqual(sessionB.user);
});

it('handles network failures and non-JSON error bodies safely', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('<html>internal details</html>', { status: 500 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(api('/events')).rejects.toThrow('Check your connection');
  await expect(api('/events')).rejects.toThrow('Request failed');
});

it('ignores malformed stored user data without crashing', () => {
  localStorage.setItem('user', '{broken');
  expect(getUser()).toBeNull();
  localStorage.setItem('user', JSON.stringify({ name: 42 }));
  expect(getUser()).toBeNull();
});

it('times out a stalled request without clearing the authenticated session', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = api('/holds/41/confirm', { method: 'POST' }, true);
    const rejected = expect(pending).rejects.toThrow('Check the result before retrying');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(getUser()).toEqual(user);
  } finally { vi.useRealTimers(); }
});

it('also bounds a response body that stalls after headers arrive', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    })));
    const rejected = expect(api('/holds/mine', {}, true)).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(getUser()).toEqual(user);
  } finally { vi.useRealTimers(); }
});

it('preserves caller cancellation instead of displaying it as a network failure', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })));
  const rejected = expect(api('/events', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(getUser()).toEqual(user);
});
