import { RequestHandler } from 'express';

// Single-process fixed-window limiter. Proxy headers are deliberately not trusted.
// Shared limiting belongs at the edge if the application is scaled horizontally.
export function authRateLimit(limit = 30, windowMs = 15 * 60_000): RequestHandler {
  const clients = new Map<string, { count: number; resetsAt: number }>();
  let nextSweep = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [key, value] of clients) if (value.resetsAt <= now) clients.delete(key);
      nextSweep = now + 60_000;
    }
    const key = req.ip || 'unknown';
    let client = clients.get(key);
    if (!client || client.resetsAt <= now) {
      if (!client && clients.size >= 10_000) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.' } });
        return;
      }
      client = { count: 0, resetsAt: now + windowMs };
      clients.set(key, client);
    }
    if (++client.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((client.resetsAt - now) / 1000)));
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please retry later.' } });
      return;
    }
    next();
  };
}
