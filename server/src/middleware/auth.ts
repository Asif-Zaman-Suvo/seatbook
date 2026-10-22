import { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../db';
import { AppConfig } from '../config';
import { asyncHandler, HttpError } from '../http';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

export interface AuthRequest extends Request { user?: AuthUser; }

export function issueToken(user: AuthUser, config: AppConfig): string {
  return jwt.sign({ email: user.email, role: user.role }, config.jwtSecret, {
    subject: String(user.id), algorithm: 'HS256', expiresIn: '7d', issuer: 'seatbook-api', audience: 'seatbook-client',
  });
}

export function requireAuth(config: AppConfig): RequestHandler {
  return asyncHandler(async (req: AuthRequest, _res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!match) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'], issuer: 'seatbook-api', audience: 'seatbook-client' });
      if (typeof verified === 'string' || !verified.sub || !/^[1-9]\d*$/.test(verified.sub) || !Number.isInteger(verified.exp) || !['ORGANIZER', 'ATTENDEE'].includes(verified.role) || typeof verified.email !== 'string') throw new Error('Invalid claims');
      payload = verified;
    } catch {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired. Please sign in again.');
    }
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id > 2147483647) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid session');
    // Read the current identity; a signed role may be stale.
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again');
    req.user = user;
    next();
  });
}

export function requireRole(role: Role): RequestHandler {
  return (req: AuthRequest, _res, next) => {
    if (req.user?.role !== role) return next(new HttpError(403, 'FORBIDDEN', `This action requires an ${role.toLowerCase()} account`));
    next();
  };
}
