import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, User } from '@prisma/client';
import { createApp } from '../src/app';
import { issueToken } from '../src/middleware/auth';
import { createHold } from '../src/services/holdService';
import prisma from '../src/db';

const config = { jwtSecret: randomBytes(48).toString('hex'), clientOrigin: 'http://localhost:5173', port: 4000 };
let alice: User, bob: User, organizer: User;
let aliceToken: string, bobToken: string, organizerToken: string;
let server: Server, base: string;

async function request(path: string, options: RequestInit = {}, token: string | null = aliceToken, target = base) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${target}${path}`, { ...options, headers, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json() };
}
const post = (path: string, body: unknown = {}, token: string | null = aliceToken, target = base) => request(path, { method: 'POST', body: JSON.stringify(body) }, token, target);

async function eventWithSeats(cols = 1, past = false) {
  return prisma.event.create({ data: {
    title: `Hold test ${randomUUID()}`, description: '', venue: 'Dhaka',
    startsAt: new Date(past ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z'),
    rows: 1, cols, priceCents: 1500, organizerId: organizer.id,
    seats: { create: Array.from({ length: cols }, (_, col) => ({ row: 0, col, label: `A${col + 1}` })) },
  }, include: { seats: { orderBy: { col: 'asc' } } } });
}

async function reserve(seatId: number, token = aliceToken, target = base) {
  const result = await post('/holds', { seatId }, token, target);
  expect(result.status).toBe(201);
  return result.body.hold as { id: number; seatId: number; status: string; createdAt: string; expiresAt: string };
}

// Shift both timestamps on synthetic fixtures, preserving the ten-minute CHECK.
// No injectable production clock, client-supplied time, or ten-minute sleeps.
async function expire(id: number, tx: Prisma.TransactionClient = prisma) {
  await tx.$executeRaw`
    WITH instant AS MATERIALIZED (SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS "now")
    UPDATE "Booking" SET "createdAt" = instant."now" - INTERVAL '10 minutes', "expiresAt" = instant."now"
    FROM instant WHERE id = ${id}`;
}

async function worker() {
  const script = `
    const {createApp} = require('./src/app.ts');
    const {loadConfig} = require('./src/config.ts');
    const prisma = require('./src/db.ts').default;
    const server = createApp(loadConfig()).listen(0, '127.0.0.1', () => console.log('READY:' + server.address().port));
    process.on('SIGTERM', () => server.close(() => prisma.$disconnect().then(() => process.exit(0))));
  `;
  const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), '-e', script], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, JWT_SECRET: config.jwtSecret, CLIENT_ORIGIN: config.clientOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const ready = new Promise<string>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Worker did not start: ${output}`)); }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Worker exited ${code}: ${output}`)); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = /READY:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); done(`http://127.0.0.1:${match[1]}`); }
    });
  });
  return { base: await ready, stop: async () => {
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(timer); }
  } };
}

beforeAll(async () => {
  const create = (name: string, role: 'ATTENDEE' | 'ORGANIZER' = 'ATTENDEE') => prisma.user.create({ data: {
    email: `holds-${name.toLowerCase()}-${randomUUID()}@seatbook.test`, name, passwordHash: 'fixture-not-used-for-login', role,
  } });
  [alice, bob, organizer] = await Promise.all([create('Alice'), create('Bob'), create('Organizer', 'ORGANIZER')]);
  [aliceToken, bobToken, organizerToken] = [alice, bob, organizer].map((user) => issueToken(user, config));
});
beforeEach(async () => {
  server = createServer(createApp(config));
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (server?.listening) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
});
afterAll(async () => { await prisma.$disconnect(); });

describe('hold creation, authorization and availability', () => {
  it('persists an exact ten-minute database deadline and ignores supplied ownership/time', async () => {
    const event = await eventWithSeats();
    const result = await post('/holds', { seatId: event.seats[0].id, userId: bob.id, expiresAt: '2099-01-01', duration: 1 });
    expect(result.status).toBe(201);
    const hold = result.body.hold;
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } });
    expect(stored).toMatchObject({ userId: alice.id, seatId: event.seats[0].id, status: 'HELD', cancelledAt: null });
    expect(stored.expiresAt!.getTime() - stored.createdAt.getTime()).toBe(600_000);
    expect(hold.createdAt).toBe(result.body.serverTime);
    expect(hold.expiresAt).toBe(stored.expiresAt!.toISOString());
    const detail = await request(`/events/${event.id}`, {}, null);
    expect(detail.body.seats[0]).toMatchObject({ available: false, status: 'HELD', holdExpiresAt: hold.expiresAt });
    expect(Object.keys(detail.body.seats[0]).sort()).toEqual(['available', 'col', 'holdExpiresAt', 'id', 'label', 'row', 'status']);
    expect((await request('/events', {}, null)).body.find((e: { id: number }) => e.id === event.id).seatsLeft).toBe(0);
    expect((await request('/bookings/mine')).body.some((b: { id: number }) => b.id === hold.id)).toBe(false);
    expect((await post(`/bookings/${hold.id}/cancel`)).status).toBe(404);
  });

  it('lists only the current attendee’s active holds with original deadlines', async () => {
    const event = await eventWithSeats(3);
    const own = await reserve(event.seats[0].id);
    const expired = await reserve(event.seats[1].id);
    await reserve(event.seats[2].id, bobToken);
    await expire(expired.id);
    const result = await request('/holds/mine');
    expect(result.status).toBe(200);
    const ids = result.body.holds.map((h: { id: number }) => h.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(expired.id);
    expect(result.body.holds.find((h: { id: number }) => h.id === own.id)).toMatchObject({ ...own, seat: { label: 'A1', event: { id: event.id } } });
    expect(Date.parse(result.body.serverTime)).toBeLessThan(Date.parse(own.expiresAt));
  });

  it('requires attendee authentication on every hold endpoint', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    for (const token of [null, organizerToken]) {
      const status = token ? 403 : 401;
      expect((await post('/holds', { seatId: hold.seatId }, token)).status).toBe(status);
      expect((await request('/holds/mine', {}, token)).status).toBe(status);
      for (const action of ['confirm', 'release']) expect((await post(`/holds/${hold.id}/${action}`, {}, token)).status).toBe(status);
    }
  });

  it('hides foreign hold identifiers and rejects owner spoofing', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    for (const action of ['confirm', 'release']) {
      const result = await post(`/holds/${hold.id}/${action}`, { userId: alice.id }, bobToken);
      expect(result.status).toBe(404);
      expect(result.body.error.code).toBe('HOLD_NOT_FOUND');
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('HELD');
  });

  it('rejects malformed bodies, IDs and missing resources', async () => {
    for (const body of [null, [], {}, { seatId: '1' }, { seatId: 0 }, { seatId: -1 }, { seatId: 1.5 }, { seatId: 2147483648 }]) {
      expect((await post('/holds', body)).status).toBe(400);
    }
    expect((await post('/holds', { seatId: 2147483647 })).status).toBe(404);
    for (const action of ['confirm', 'release']) {
      expect((await post(`/holds/1junk/${action}`)).status).toBe(400);
      expect((await post(`/holds/2147483647/${action}`)).status).toBe(404);
    }
  });

  it('rejects holds on confirmed bookings and does not treat direct bookings as holds', async () => {
    const event = await eventWithSeats();
    const booking = await post('/bookings', { seatId: event.seats[0].id });
    expect(booking.status).toBe(201);
    expect((await post('/holds', { seatId: event.seats[0].id }, bobToken)).status).toBe(409);
    for (const action of ['confirm', 'release']) expect((await post(`/holds/${booking.body.id}/${action}`)).status).toBe(404);
    expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(1);
  });

  it('rejects new holds and confirmation after event start, while allowing release', async () => {
    const past = await eventWithSeats(1, true);
    expect((await post('/holds', { seatId: past.seats[0].id })).body.error.code).toBe('EVENT_STARTED');
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    await prisma.$executeRaw`UPDATE "Event" SET "startsAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE id = ${event.id}`;
    expect((await post(`/holds/${hold.id}/confirm`)).body.error.code).toBe('EVENT_STARTED');
    expect((await request('/holds/mine')).body.holds.some((h: { id: number }) => h.id === hold.id)).toBe(false);
    expect((await request(`/events/${event.id}`)).body.seats[0]).toMatchObject({ available: false, status: 'CLOSED' });
    expect((await post(`/holds/${hold.id}/release`)).status).toBe(200);
  });

  it('uses database time despite application clock skew', async () => {
    const event = await eventWithSeats();
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const result = await createHold(alice.id, event.seats[0].id);
    expect(result.hold.createdAt.getUTCFullYear()).toBeGreaterThan(2020);
    expect(result.hold.expiresAt.getTime() - result.hold.createdAt.getTime()).toBe(600_000);
  });
});

describe('expiration, confirmation, release and retry behavior', () => {
  it('confirms once, retries the same booking, then preserves cancellation and reacquisition', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    const confirmed = await post(`/holds/${hold.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.booking).toMatchObject({ id: hold.id, userId: alice.id, status: 'CONFIRMED', expiresAt: hold.expiresAt });
    await expire(hold.id); // Former deadline passing cannot undo a permanent booking.
    expect((await post(`/holds/${hold.id}/confirm`)).body.booking.id).toBe(hold.id);
    expect((await post(`/holds/${hold.id}/release`)).status).toBe(409);
    expect((await post('/holds', { seatId: hold.seatId }, bobToken)).status).toBe(409);
    expect((await post(`/bookings/${hold.id}/cancel`)).status).toBe(200);
    const replacement = await reserve(hold.seatId, bobToken);
    expect((await post(`/holds/${hold.id}/confirm`)).body.error.code).toBe('HOLD_NOT_ACTIVE');
    expect((await post(`/bookings/${hold.id}/cancel`)).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe('HELD');
    expect((await request('/bookings/mine')).body.find((b: { id: number }) => b.id === hold.id).status).toBe('CANCELLED');
  });

  it('returns the original hold on retry without extending its expiration', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    const retry = await post('/holds', { seatId: hold.seatId });
    expect(retry.status).toBe(200);
    expect(retry.body.hold).toEqual(hold);
    expect(await prisma.booking.count({ where: { seatId: hold.seatId } })).toBe(1);
  });

  it('releases idempotently, reacquires and ignores stale release retries', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    expect((await post(`/holds/${hold.id}/release`)).body.hold.status).toBe('RELEASED');
    const replacement = await reserve(hold.seatId, bobToken);
    expect((await post(`/holds/${hold.id}/release`)).body.hold.status).toBe('RELEASED');
    expect((await post(`/holds/${hold.id}/confirm`)).status).toBe(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe('HELD');
  });

  it('makes expired seats available without cleanup and rejects expired confirmation/release', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    await expire(hold.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('HELD');
    expect((await request(`/events/${event.id}`)).body.seats[0]).toMatchObject({ available: true, status: 'AVAILABLE', holdExpiresAt: null });
    expect((await request('/events')).body.find((e: { id: number }) => e.id === event.id).seatsLeft).toBe(1);
    const rejected = await post(`/holds/${hold.id}/confirm`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('HOLD_EXPIRED');
    expect((await post(`/holds/${hold.id}/release`)).body.error.code).toBe('HOLD_EXPIRED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('EXPIRED');
  });

  it.each(['same owner', 'different owner', 'immediate booking'])('reconciles an expired hold for %s without deleting history', async (kind) => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    await expire(hold.id);
    const result = kind === 'immediate booking'
      ? await post('/bookings', { seatId: hold.seatId }, bobToken)
      : await post('/holds', { seatId: hold.seatId }, kind === 'same owner' ? aliceToken : bobToken);
    expect(result.status).toBe(201);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('EXPIRED');
    expect(await prisma.booking.count({ where: { seatId: hold.seatId } })).toBe(2);
    if (kind !== 'immediate booking') {
      expect(result.body.hold.id).not.toBe(hold.id);
      expect(Date.parse(result.body.hold.expiresAt) - Date.parse(result.body.hold.createdAt)).toBe(600_000);
    }
  });

  it('survives two actual API processes and recovers the original deadline after restart', async () => {
    const event = await eventWithSeats(2);
    const first = await worker();
    let hold: Awaited<ReturnType<typeof reserve>>, expired: Awaited<ReturnType<typeof reserve>>;
    try {
      hold = await reserve(event.seats[0].id, aliceToken, first.base);
      expired = await reserve(event.seats[1].id, aliceToken, first.base);
    }
    finally { await first.stop(); }
    await expire(expired.id);
    const second = await worker();
    try {
      const recovered = await request('/holds/mine', {}, aliceToken, second.base);
      expect(recovered.body.holds.find((h: { id: number }) => h.id === hold.id)).toMatchObject(hold);
      expect(recovered.body.holds.some((h: { id: number }) => h.id === expired.id)).toBe(false);
      await reserve(expired.seatId, bobToken, second.base);
      expect((await post('/holds', { seatId: hold.seatId }, bobToken, second.base)).status).toBe(409);
      expect((await post(`/holds/${hold.id}/confirm`, {}, aliceToken, second.base)).body.booking.id).toBe(hold.id);
    } finally { await second.stop(); }
  }, 30_000);
});

describe('database constraints, concurrency and failure recovery', () => {
  it('returns a safe retryable error on seat lock timeout without acquiring a hold', async () => {
    const event = await eventWithSeats();
    const blocker = new PrismaClient();
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((done) => { ready = done; });
    const gate = new Promise<void>((done) => { release = done; });
    const held = blocker.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${event.seats[0].id} FOR UPDATE`;
      ready();
      await gate;
    }, { timeout: 10_000 });
    try {
      await Promise.race([locked, held]);
      const rejected = await post('/holds', { seatId: event.seats[0].id });
      expect(rejected.status).toBe(503);
      expect(rejected.body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable. Please retry.' } });
      expect(await prisma.booking.findMany({ where: { seatId: event.seats[0].id } })).toEqual([]);
    } finally {
      release();
      await held;
      await blocker.$disconnect();
    }
    const retried = await reserve(event.seats[0].id);
    const stored = await prisma.booking.findMany({ where: { seatId: event.seats[0].id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: retried.id, userId: alice.id, status: 'HELD' });
  });

  it.each([false, true])('allows one winner among twelve competing attendees (expired predecessor: %s)', async (hasExpiredPredecessor) => {
    const event = await eventWithSeats();
    const predecessor = hasExpiredPredecessor ? await reserve(event.seats[0].id) : null;
    if (predecessor) await expire(predecessor.id);
    // Each request is a different attendee, so successful idempotent retries
    // cannot be mistaken for two different users acquiring the same seat.
    const users = await Promise.all(Array.from({ length: 12 }, (_, i) => prisma.user.create({ data: {
      email: `race-${randomUUID()}@seatbook.test`, name: `Attendee ${i}`, passwordHash: 'fixture-only',
    } })));
    const results = await Promise.all(users.map((user) => post('/holds', { seatId: event.seats[0].id }, issueToken(user, config))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
    const rows = await prisma.booking.findMany({ where: { seatId: event.seats[0].id, status: 'HELD' } });
    expect(rows).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === 201);
    expect(rows[0]).toMatchObject({ id: results[winner].body.hold.id, userId: users[winner].id, status: 'HELD' });
    expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(predecessor ? 2 : 1);
    if (predecessor) expect((await prisma.booking.findUniqueOrThrow({ where: { id: predecessor.id } })).status).toBe('EXPIRED');
  });

  it('serializes concurrent same-owner retries without extending or duplicating a hold', async () => {
    const event = await eventWithSeats();
    const results = await Promise.all(Array.from({ length: 8 }, () => post('/holds', { seatId: event.seats[0].id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => JSON.stringify(r.body.hold))).size).toBe(1);
    expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(1);
  });

  it('serializes twelve confirmations into one permanent booking', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    const results = await Promise.all(Array.from({ length: 12 }, () => post(`/holds/${hold.id}/confirm`)));
    expect(results.every((r) => r.status === 200 && r.body.booking.id === hold.id)).toBe(true);
    expect(await prisma.booking.count({ where: { seatId: hold.seatId, status: 'CONFIRMED' } })).toBe(1);
    expect(await prisma.booking.count({ where: { seatId: hold.seatId } })).toBe(1);
  });

  it('prevents a simultaneous hold and immediate booking from both succeeding', async () => {
    const event = await eventWithSeats();
    const seatId = event.seats[0].id;
    const results = await Promise.all([post('/holds', { seatId }), post('/bookings', { seatId }, bobToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await prisma.booking.findMany({ where: { seatId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: results[0].status === 201 ? 'HELD' : 'CONFIRMED', userId: results[0].status === 201 ? alice.id : bob.id });
  });

  it('blocks immediate booking by either attendee during an active hold', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    for (const token of [aliceToken, bobToken]) expect((await post('/bookings', { seatId: hold.seatId }, token)).status).toBe(409);
    expect(await prisma.booking.count({ where: { seatId: hold.seatId } })).toBe(1);
  });

  it('serializes confirmation versus release into a single terminal outcome', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    const [confirmed, released] = await Promise.all([post(`/holds/${hold.id}/confirm`), post(`/holds/${hold.id}/release`)]);
    expect([confirmed.status, released.status].sort()).toEqual([200, 409]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(confirmed.status === 200 ? 'CONFIRMED' : 'RELEASED');
  });

  it('accepts concurrent release retries while leaving a replacement hold intact', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(`/holds/${hold.id}/release`)));
    expect(results.every((r) => r.status === 200 && r.body.hold.status === 'RELEASED')).toBe(true);
    const replacement = await reserve(hold.seatId, bobToken);
    expect((await post(`/holds/${hold.id}/release`)).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe('HELD');
  });

  it('serializes expired confirmation versus reacquisition without affecting the new owner', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    await expire(hold.id);
    const [confirmed, acquired] = await Promise.all([post(`/holds/${hold.id}/confirm`), post('/holds', { seatId: hold.seatId }, bobToken)]);
    expect(confirmed.status).toBe(409);
    expect(acquired.status).toBe(201);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('EXPIRED');
    expect((await post(`/holds/${hold.id}/release`)).status).toBe(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: acquired.body.hold.id } })).status).toBe('HELD');
  });

  it('samples expiration after waiting for the seat lock', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>((done) => { locked = done; });
    const gate = new Promise<void>((done) => { unlock = done; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${hold.seatId} FOR UPDATE`;
      locked();
      await gate;
      await expire(hold.id, tx);
    }, { timeout: 5000 });
    await ready;
    const pending = post(`/holds/${hold.id}/confirm`);
    try {
      const deadline = performance.now() + 2000;
      let waiting = false;
      while (performance.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'SELECT "id" FROM "Seat" WHERE%FOR UPDATE%'`;
        if (rows[0].count) { waiting = true; break; }
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(waiting).toBe(true);
    } finally { unlock(); await blocker; }
    const result = await pending;
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('HOLD_EXPIRED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('EXPIRED');
  });

  it('enforces hold-versus-booking uniqueness for independent clients bypassing locks', async () => {
    const event = await eventWithSeats();
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
    const clients = [new PrismaClient(), new PrismaClient()];
    try {
      const results = await Promise.allSettled([
        clients[0].booking.create({ data: { seatId: event.seats[0].id, userId: alice.id, status: 'HELD', createdAt: clock.now, expiresAt: new Date(clock.now.getTime() + 600_000) } }),
        clients[1].booking.create({ data: { seatId: event.seats[0].id, userId: bob.id } }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('P2002');
      expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(1);
    } finally { await Promise.all(clients.map((client) => client.$disconnect())); }
  });

  it('rejects missing or non-ten-minute hold deadlines at the database boundary', async () => {
    const event = await eventWithSeats();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    for (const expiresAt of [null, new Date(createdAt.getTime() + 599_999), new Date(createdAt.getTime() + 600_001)]) {
      await expect(prisma.booking.create({ data: { seatId: event.seats[0].id, userId: alice.id, status: 'HELD', createdAt, expiresAt } })).rejects.toThrow();
    }
    expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(0);
  });

  it('rolls back expiration reconciliation if replacement insertion fails', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    await expire(hold.id);
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } });
    await expect(createHold(2147483647, hold.seatId)).rejects.toThrow(); // Real foreign-key failure.
    expect(await prisma.booking.findMany({ where: { seatId: hold.seatId } })).toEqual([before]);
    await reserve(hold.seatId, bobToken);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('EXPIRED');
  });

  it('rolls back a real database confirmation failure and permits a safe retry', async () => {
    const event = await eventWithSeats();
    const hold = await reserve(event.seats[0].id);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Scope the injected CHECK to this synthetic row in the guarded test DB.
    await prisma.$executeRawUnsafe(`ALTER TABLE "Booking" ADD CONSTRAINT "phase2_test_confirm_failure" CHECK (id <> ${hold.id} OR status <> 'CONFIRMED')`);
    try {
      const failed = await post(`/holds/${hold.id}/confirm`);
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe('HELD');
    } finally { await prisma.$executeRaw`ALTER TABLE "Booking" DROP CONSTRAINT "phase2_test_confirm_failure"`; }
    expect((await post(`/holds/${hold.id}/confirm`)).status).toBe(200);
  });

  it.each(['23505', '23503'])('maps raw SQL constraint %s to a safe HTTP conflict', async (code) => {
    const event = await eventWithSeats();
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private SQL arguments', {
      code: 'P2010', clientVersion: '5.22.0', meta: { code },
    }));
    const failed = await post('/holds', { seatId: event.seats[0].id });
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('CONFLICT');
    expect(JSON.stringify(failed.body)).not.toContain('private');
    expect(await prisma.booking.count({ where: { seatId: event.seats[0].id } })).toBe(0);
  });
});
