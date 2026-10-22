import { afterEach, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { authRateLimit } from '../src/middleware/authRateLimit';

afterEach(() => vi.useRealTimers());

it('limits attempts by socket IP and allows retries after the window', () => {
  vi.useFakeTimers();
  const middleware = authRateLimit(2, 60_000);
  const req = { ip: '127.0.0.1' } as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as unknown as Response;
  const next = vi.fn();
  middleware(req, res, next);
  middleware(req, res, next);
  middleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(2);
  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  vi.advanceTimersByTime(60_000);
  middleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(3);
});
