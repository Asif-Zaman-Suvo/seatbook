import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Require an explicit disposable target before any Prisma client is imported.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to the isolated seatbook_test database');
const parsed = new URL(url);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/seatbook_test' || parsed.username !== 'seatbook_test') {
  throw new Error('Integration tests require the dedicated seatbook_test database and user');
}
process.env.DATABASE_URL = url;
const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
});
if (result.status !== 0) throw new Error(`Test migrations failed: ${result.stdout}\n${result.stderr}`);
