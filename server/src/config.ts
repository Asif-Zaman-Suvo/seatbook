import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface AppConfig {
  jwtSecret: string;
  clientOrigin: string;
  port: number;
}

// Local development gets a random, persistent secret. Production fails closed.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') throw new Error('JWT_SECRET must be configured');
    const path = resolve(env.DEV_SECRET_PATH || '.data/jwt-secret');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    jwtSecret = readFileSync(path, 'utf8').trim();
  }
  if (!jwtSecret.trim() || Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const clientOrigin = env.CLIENT_ORIGIN || 'http://localhost:5173';
  const origin = new URL(clientOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== clientOrigin) throw new Error('CLIENT_ORIGIN must be a single HTTP(S) origin');
  return { jwtSecret, clientOrigin, port };
}
