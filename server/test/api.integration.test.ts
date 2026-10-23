import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient, User } from '@prisma/client';
import { createApp } from '../src/app';
import { issueToken } from '../src/middleware/auth';
import { bookSeat } from '../src/services/bookingService';
import prisma from '../src/db';

const config = { jwtSecret: randomBytes(48).toString('hex'), clientOrigin: 'http://localhost:5173', port: 4000 };
let alice: User;
let bob: User;
let organizer: User;
let aliceToken: string;
let bobToken: string;
let organizerToken: string;
let server: Server;
let base: string;

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { ...options, headers, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function post(path: string, body: unknown, token?: string) {
  return request(path, { method: 'POST', body: JSON.stringify(body) }, token);
}

async function eventWithSeats(past = false, cols = 1) {
  return prisma.event.create({
    data: {
      title: `Test ${randomUUID()}`, description: '', venue: 'Dhaka',
      startsAt: new Date(Date.now() + (past ? -1 : 1) * 86_400_000),
      rows: 1, cols, priceCents: 1500, organizerId: organizer.id,
      seats: { create: Array.from({ length: cols }, (_, col) => ({ row: 0, col, label: `A${col + 1}` })) },
    }, include: { seats: { orderBy: { col: 'asc' } } },
  });
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('test-password-123', 10);
  const create = (name: string, role: 'ATTENDEE' | 'ORGANIZER' = 'ATTENDEE') => prisma.user.create({
    data: { email: `${name.toLowerCase()}-${randomUUID()}@seatbook.test`, name, passwordHash, role },
  });
  [alice, bob, organizer] = await Promise.all([create('Alice'), create('Bob'), create('Organizer', 'ORGANIZER')]);
  aliceToken = issueToken(alice, config);
  bobToken = issueToken(bob, config);
  organizerToken = issueToken(organizer, config);
});

beforeEach(async () => {
  server = createServer(createApp(config));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
afterAll(async () => { await prisma.$disconnect(); });

describe('liveness and database readiness', () => {
  it('reports ready only after connecting to the migrated database', async () => {
    const ready = await request('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ok: true });
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect((await request('/health')).status).toBe(200);
  });

  it('reports a safe retryable failure while preserving process liveness', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('private database diagnostic'));
    const ready = await request('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable. Please retry.' } });
    expect((await request('/health')).body).toEqual({ ok: true });
    expect((await request('/ready')).status).toBe(200);
  });
});

describe('authentication and authorization', () => {
  it.each(['ATTENDEE', 'ORGANIZER'] as const)('registers and logs in a %s without exposing password hashes', async (role) => {
    const email = `${randomUUID()}@seatbook.test`;
    const registered = await post('/auth/register', { email: ` ${email.toUpperCase()} `, password: 'test-password-123', name: ' New User ', role });
    expect(registered.status).toBe(201);
    expect(registered.body.user).toMatchObject({ email, name: 'New User', role });
    expect(Object.keys(registered.body.user).sort()).toEqual(['email', 'id', 'name', 'role']);
    expect(jwt.verify(registered.body.token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'seatbook-api', audience: 'seatbook-client' })).toMatchObject({ sub: String(registered.body.user.id), role });
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toBe('test-password-123');
    expect(await bcrypt.compare('test-password-123', stored.passwordHash)).toBe(true);
    const login = await post('/auth/login', { email: email.toUpperCase(), password: 'test-password-123' });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual(registered.body.user);
    expect((await post('/auth/register', { email, password: 'test-password-123', name: 'Other' })).status).toBe(409);
  });

  it('preserves legacy login passwords and returns the same credential error', async () => {
    const legacy = await prisma.user.create({ data: { email: `${randomUUID()}@seatbook.test`, name: 'Legacy', passwordHash: await bcrypt.hash('password123', 10) } });
    expect((await post('/auth/login', { email: legacy.email, password: 'password123' })).status).toBe(200);
    const wrong = await post('/auth/login', { email: alice.email, password: 'wrong' });
    const missing = await post('/auth/login', { email: 'missing@seatbook.test', password: 'wrong' });
    expect(wrong.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);
  });

  it.each([null, [], {}, { email: 'bad', password: 'test-password-123' }, { email: 'valid@example.com', password: 123 }])('rejects invalid authentication bodies: %j', async (body) => {
    expect((await post('/auth/login', body)).status).toBe(400);
    expect((await post('/auth/register', body)).status).toBe(400);
  });

  it.each(['a'.repeat(80), '🔒'.repeat(19)])('logs in with an existing bcrypt password over 72 bytes (%#)', async (password) => {
    const email = `${randomUUID()}@seatbook.test`;
    const legacy = await prisma.user.create({ data: { email, name: 'Legacy', passwordHash: await bcrypt.hash(password, 10) } });
    const before = legacy.passwordHash;
    const login = await post('/auth/login', { email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(legacy.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash).toBe(before);
    const registration = await post('/auth/register', { email: `${randomUUID()}@seatbook.test`, name: 'New', password });
    expect(registration.status).toBe(400);
    expect(registration.body.error.code).toBe('VALIDATION_ERROR');
    expect((await post('/auth/login', { email, password: 'incorrect-password' })).status).toBe(401);
  });

  it('rejects login bodies beyond the JSON budget without evaluating bcrypt', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect((await post('/auth/login', { email: alice.email, password: 'a'.repeat(32769) })).status).toBe(413);
    expect(compare).not.toHaveBeenCalled();
  });

  it('rejects concurrent duplicate registration with a controlled conflict', async () => {
    const body = { email: `${randomUUID()}@seatbook.test`, name: 'Concurrent', password: 'test-password-123' };
    const results = await Promise.all([post('/auth/register', body), post('/auth/register', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email: body.email } })).toBe(1);
  });

  it('rejects missing, malformed, expired, forged, and wrong-algorithm tokens', async () => {
    const claims = { email: alice.email, role: alice.role };
    const options = { subject: String(alice.id), issuer: 'seatbook-api', audience: 'seatbook-client' };
    const tokens = [
      'not-a-token',
      jwt.sign(claims, config.jwtSecret, { ...options, expiresIn: -1 }),
      jwt.sign(claims, 'seatbook-secret-123', { ...options, expiresIn: '1h' }),
      jwt.sign(claims, config.jwtSecret, { ...options, expiresIn: '1h', algorithm: 'HS384' }),
      jwt.sign(claims, config.jwtSecret, options),
      jwt.sign(claims, config.jwtSecret, { ...options, issuer: 'someone-else', expiresIn: '1h' }),
      jwt.sign({ ...claims, role: 'ADMIN' }, config.jwtSecret, { ...options, expiresIn: '1h' }),
    ];
    expect((await request('/bookings/mine')).status).toBe(401);
    for (const token of tokens) expect((await request('/bookings/mine', {}, token)).status).toBe(401);
    expect((await request('/bookings/mine', { headers: { Authorization: aliceToken } })).status).toBe(401);
    expect((await request('/bookings/mine', {}, aliceToken)).status).toBe(200);
  });

  it('authorizes using the current database role rather than a signed stale role', async () => {
    const stale = issueToken({ ...alice, role: 'ORGANIZER' }, config);
    expect((await post('/events', {}, stale)).status).toBe(403);
    expect((await request('/bookings/mine', {}, organizerToken)).status).toBe(403);
    expect((await post('/bookings', { seatId: 1 }, organizerToken)).status).toBe(403);
    expect((await post('/bookings/1/cancel', {}, organizerToken)).status).toBe(403);
  });

  it('rejects an otherwise valid token for a nonexistent identity', async () => {
    const token = issueToken({ id: 2147483647, email: 'missing@seatbook.test', role: 'ATTENDEE' }, config);
    expect((await request('/bookings/mine', {}, token)).status).toBe(401);
  });

  it('throttles auth attempts and ignores spoofed forwarded addresses', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await request('/auth/login', { method: 'POST', body: '{}', headers: { 'X-Forwarded-For': `192.0.2.${i}` } })).status).toBe(400);
    }
    const limited = await post('/auth/login', {});
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('events and safe error responses', () => {
  it('creates an entire seat grid as an organizer', async () => {
    const body = { title: 'New event', venue: 'Dhaka', startsAt: new Date(Date.now() + 86_400_000).toISOString(), rows: 2, cols: 3, priceCents: 0 };
    expect((await post('/events', body)).status).toBe(401);
    expect((await post('/events', body, aliceToken)).status).toBe(403);
    const created = await post('/events', body, organizerToken);
    expect(created.status).toBe(201);
    const detail = await request(`/events/${created.body.id}`);
    expect(detail.body.seats.map((s: { label: string }) => s.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    expect(detail.body.organizer).toEqual({ id: organizer.id, name: organizer.name });
    expect(detail.body.priceCents).toBe(0);
  });

  it('returns controlled errors for invalid event input and IDs', async () => {
    const input = { title: 'Talk', venue: 'Dhaka', startsAt: new Date(Date.now() + 86_400_000).toISOString(), rows: 1, cols: 1, priceCents: 0 };
    const before = await prisma.event.count();
    for (const change of [{ rows: -1 }, { cols: 0 }, { rows: 1.5 }, { priceCents: -10 }, { startsAt: 'bad' }, { title: ' ' }]) {
      expect((await post('/events', { ...input, ...change }, organizerToken)).status).toBe(400);
    }
    expect(await prisma.event.count()).toBe(before);
    expect((await request('/events/1junk')).status).toBe(400);
    expect((await request('/events/2147483647')).status).toBe(404);
    expect((await request('/does-not-exist')).status).toBe(404);
  });

  it('rejects invalid JSON and oversized bodies consistently', async () => {
    expect((await request('/auth/login', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await post('/auth/register', { junk: 'x'.repeat(33_000) })).status).toBe(413);
  });

  it('forwards asynchronous failures without exposing internals or returning empty success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('secret database connection details'));
    const failed = await request('/events');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    vi.spyOn(prisma.booking, 'findMany').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private details', { code: 'P2024', clientVersion: '5.22.0' }));
    const unavailable = await request('/bookings/mine', {}, aliceToken);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(unavailable.body)).not.toContain('private');
    expect((await request('/health')).status).toBe(200);
  });

  it('restricts browser CORS and disables API response caching', async () => {
    const result = await request('/health', { headers: { Origin: config.clientOrigin } });
    expect(result.headers.get('access-control-allow-origin')).toBe(config.clientOrigin);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-powered-by')).toBeNull();
  });
});

describe('booking integrity and ownership', () => {
  it('allows owner cancellation after event start while keeping the event closed', async () => {
    const event = await eventWithSeats(true);
    const booking = await prisma.booking.create({ data: { seatId: event.seats[0].id, userId: alice.id } });
    expect((await post('/bookings/' + booking.id + '/cancel', {}, bobToken)).status).toBe(404);
    expect((await post('/bookings/' + booking.id + '/cancel', {}, aliceToken)).status).toBe(200);
    const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect((await post('/bookings/' + booking.id + '/cancel', {}, aliceToken)).status).toBe(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toEqual(cancelled);
    const detail = await request('/events/' + event.id);
    expect(detail.body.seats[0]).toMatchObject({ status: 'CLOSED', available: false });
    const history = await request('/bookings/mine', {}, aliceToken);
    expect(history.body.find((row: { id: number }) => row.id === booking.id)).toMatchObject({ status: 'CANCELLED', seat: 'A1' });
  });

  it('books, scopes history, rejects foreign cancellation, cancels idempotently, and rebooks', async () => {
    const event = await eventWithSeats();
    const seatId = event.seats[0].id;
    const booked = await post('/bookings', { seatId, userId: bob.id }, aliceToken);
    expect(booked.status).toBe(201);
    expect(booked.body.userId).toBe(alice.id);
    const id = booked.body.id as number;
    expect((await request('/bookings/mine', {}, aliceToken)).body.some((b: { id: number }) => b.id === id)).toBe(true);
    expect((await request('/bookings/mine', {}, bobToken)).body.some((b: { id: number }) => b.id === id)).toBe(false);
    expect((await post(`/bookings/${id}/cancel`, {}, bobToken)).status).toBe(404);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED');
    expect((await post(`/bookings/${id}/cancel`, {}, aliceToken)).status).toBe(200);
    const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect((await post(`/bookings/${id}/cancel`, {}, aliceToken)).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).cancelledAt).toEqual(cancelled.cancelledAt);
    const listed = (await request('/events')).body.find((e: { id: number }) => e.id === event.id);
    expect(listed.seatsLeft).toBe(1);
    expect((await request(`/events/${event.id}`)).body.seats[0].available).toBe(true);
    expect((await post('/bookings', { seatId }, bobToken)).status).toBe(201);
    // A retry concerning old history cannot free a replacement booking.
    expect((await post(`/bookings/${id}/cancel`, {}, aliceToken)).status).toBe(200);
    expect(await prisma.booking.count({ where: { seatId, status: 'CONFIRMED' } })).toBe(1);
    expect((await request(`/events/${event.id}`)).body.seats[0].available).toBe(false);
  });

  it('rejects invalid IDs, missing seats/bookings, and booking started events', async () => {
    for (const seatId of [null, '1', 0, -1, 1.5, 2147483648]) expect((await post('/bookings', { seatId }, aliceToken)).status).toBe(400);
    expect((await post('/bookings', { seatId: 2147483647 }, aliceToken)).status).toBe(404);
    expect((await post('/bookings/1junk/cancel', {}, aliceToken)).status).toBe(400);
    expect((await post('/bookings/2147483647/cancel', {}, aliceToken)).status).toBe(404);
    const past = await eventWithSeats(true);
    const rejected = await post('/bookings', { seatId: past.seats[0].id }, aliceToken);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('EVENT_STARTED');
    expect((await request(`/events/${past.id}`)).body.seats[0].available).toBe(false);
  });

  it('allows exactly one winner among twelve simultaneous booking requests', async () => {
    const event = await eventWithSeats();
    const seatId = event.seats[0].id;
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post('/bookings', { seatId }, i % 2 ? aliceToken : bobToken)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
    expect(await prisma.booking.count({ where: { seatId, status: 'CONFIRMED' } })).toBe(1);
    const stored = await prisma.booking.findMany({ where: { seatId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: results.find((r) => r.status === 201)!.body.id,
      userId: results.find((r) => r.status === 201)!.body.userId,
      seatId, status: 'CONFIRMED', cancelledAt: null,
    });
  });

  it('enforces confirmed-seat uniqueness even for independent clients bypassing the service', async () => {
    const event = await eventWithSeats();
    const clients = [new PrismaClient(), new PrismaClient()];
    try {
      const results = await Promise.allSettled(clients.map((client, i) => client.booking.create({ data: { seatId: event.seats[0].id, userId: i ? alice.id : bob.id } })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('P2002');
    } finally { await Promise.all(clients.map((client) => client.$disconnect())); }
  });

  it('serializes cancellation and rebooking without touching the replacement booking', async () => {
    const event = await eventWithSeats();
    const seatId = event.seats[0].id;
    const original = await post('/bookings', { seatId }, aliceToken);
    const cancelPath = `/bookings/${original.body.id}/cancel`;
    const results = await Promise.all([post(cancelPath, {}, aliceToken), post(cancelPath, {}, aliceToken), post('/bookings', { seatId }, bobToken)]);
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(200);
    if (results[2].status === 409) expect((await post('/bookings', { seatId }, bobToken)).status).toBe(201);
    else expect(results[2].status).toBe(201);
    const active = await prisma.booking.findMany({ where: { seatId, status: 'CONFIRMED' } });
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe(bob.id);
  });

  it('rolls back failed transactions and releases locks for the next booking', async () => {
    const event = await eventWithSeats();
    const seatId = event.seats[0].id;
    await expect(bookSeat(2147483647, seatId)).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({ data: { seatId, userId: alice.id } });
      // Real database CHECK violation after the insert must roll back both writes.
      await tx.$executeRaw`UPDATE "Booking" SET "status" = 'CANCELLED' WHERE "id" = ${booking.id}`;
    })).rejects.toThrow();
    expect(await prisma.booking.count({ where: { seatId } })).toBe(0);
    expect((await post('/bookings', { seatId }, bobToken)).status).toBe(201);
  });

  it('rejects invalid event data and noncanonical emails at the database boundary', async () => {
    const event = await eventWithSeats();
    await expect(prisma.event.update({ where: { id: event.id }, data: { priceCents: -1 } })).rejects.toThrow();
    await expect(prisma.event.update({ where: { id: event.id }, data: { rows: 0 } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: `UPPER-${randomUUID()}@EXAMPLE.COM`, name: 'Bad', passwordHash: 'not-used' } })).rejects.toThrow();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).priceCents).toBe(1500);
  });
});
