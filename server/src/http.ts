import { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Express 4 does not forward rejected async handlers automatically.
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => handler(req, res, next)).catch(next); };
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const bodyError = error as { type?: string } | null;
  if (bodyError?.type === 'entity.parse.failed' || bodyError?.type === 'entity.too.large') {
    const tooLarge = bodyError.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({ error: { code: tooLarge ? 'BODY_TOO_LARGE' : 'INVALID_JSON', message: tooLarge ? 'Request body is too large' : 'Invalid JSON body' } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'That email or seat is already in use' } });
      return;
    }
    if (error.code === 'P2003') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'The referenced resource is no longer available' } });
      return;
    }
  }
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
    : error instanceof Prisma.PrismaClientInitializationError ? error.errorCode : undefined;
  const retryableSql = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010'
    && ['55P03', '40P01', '40001'].includes(String(error.meta?.code));
  const unavailable = retryableSql || ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'].includes(code || '');
  // Exception messages can contain SQL arguments; do not log bodies or tokens.
  console.error('Request failed', { method: req.method, path: req.path, name: error instanceof Error ? error.name : 'UnknownError', code });
  res.status(unavailable ? 503 : 500).json({ error: { code: unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR', message: unavailable ? 'Service temporarily unavailable. Please retry.' : 'Something went wrong' } });
};
