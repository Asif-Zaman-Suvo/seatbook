import express from 'express';
import cors from 'cors';
import { AppConfig } from './config';
import authRoutes from './routes/auth';
import eventRoutes from './routes/events';
import bookingRoutes from './routes/bookings';
import holdRoutes from './routes/holds';
import { requireAuth } from './middleware/auth';
import { authRateLimit } from './middleware/authRateLimit';
import { asyncHandler, errorHandler, HttpError } from './http';
import prisma from './db';

export function createApp(config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  // Keep liveness independent of PostgreSQL. Readiness also verifies that the
  // essential migrated tables are accessible without reading customer records.
  app.get('/ready', asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1 FROM "User", "Event", "Seat", "Booking" LIMIT 0`;
    } catch {
      throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable. Please retry.');
    }
    res.json({ ok: true });
  }));
  const authenticate = requireAuth(config);
  app.use('/auth', authRateLimit(), authRoutes(config));
  app.use('/events', eventRoutes(authenticate));
  app.use('/bookings', bookingRoutes(authenticate));
  app.use('/holds', holdRoutes(authenticate));
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Resource not found')));
  app.use(errorHandler);
  return app;
}
