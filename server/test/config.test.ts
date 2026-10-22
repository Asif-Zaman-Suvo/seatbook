import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('configuration', () => {
  it('fails closed without a production secret or with a short secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'too-short' })).toThrow('32 bytes');
  });

  it('uses a supplied secret and validates the origin and port', () => {
    const secret = randomBytes(32).toString('hex');
    expect(loadConfig({ JWT_SECRET: secret }).jwtSecret).toBe(secret);
    expect(() => loadConfig({ JWT_SECRET: secret, PORT: 'NaN' })).toThrow('PORT');
    expect(() => loadConfig({ JWT_SECRET: secret, CLIENT_ORIGIN: 'https://example.com/path' })).toThrow('origin');
  });

  it('persists an unpredictable development secret across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seatbook-config-'));
    directories.push(dir);
    const path = join(dir, 'private', 'jwt-secret');
    const env = { NODE_ENV: 'development', DEV_SECRET_PATH: path };
    const first = loadConfig(env);
    expect(first.jwtSecret).toHaveLength(96);
    expect(loadConfig(env).jwtSecret).toBe(first.jwtSecret);
    expect(readFileSync(path, 'utf8')).toBe(first.jwtSecret);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const other = loadConfig({ ...env, DEV_SECRET_PATH: join(dir, 'other-secret') });
    expect(other.jwtSecret).not.toBe(first.jwtSecret);
  });
});
