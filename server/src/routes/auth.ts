import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { AppConfig } from '../config';
import { asyncHandler, HttpError } from '../http';
import { credentials, registration } from '../validation';
import { issueToken } from '../middleware/auth';

const publicUser = { id: true, email: true, name: true, role: true } as const;

export default function authRoutes(config: AppConfig) {
  const router = Router();
  router.post('/register', asyncHandler(async (req, res) => {
    const { password, ...data } = registration(req.body);
    // The database unique constraint also resolves simultaneous registrations.
    if (await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } })) throw new HttpError(409, 'EMAIL_IN_USE', 'That email is already registered');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { ...data, passwordHash }, select: publicUser });
    res.status(201).json({ token: issueToken(user, config), user });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = credentials(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    const { passwordHash: _hash, createdAt: _createdAt, ...safeUser } = user;
    res.json({ token: issueToken(user, config), user: safeUser });
  }));
  return router;
}
