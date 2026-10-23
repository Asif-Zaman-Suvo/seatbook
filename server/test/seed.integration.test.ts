import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { seedDatabase } from '../prisma/seedData';

const base = new URL(process.env.TEST_DATABASE_URL!);
if (base.username !== 'seatbook_test' || base.pathname !== '/seatbook_test') {
  throw new Error('Seed tests require the disposable seatbook_test database and user');
}
const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });

function assertFixture(url: string) {
  const target = new URL(url);
  if (target.hostname !== base.hostname || target.port !== base.port || target.username !== base.username ||
      !/^\/seatbook_seed_[a-f0-9]{32}$/.test(target.pathname)) throw new Error('Unsafe seed fixture target');
}

function cli(url: string, seed = false) {
  assertFixture(url);
  return spawnSync(process.execPath, seed
    ? [resolve('node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts']
    : [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url }, encoding: 'utf8', timeout: 20_000,
  });
}

async function snapshot(db: PrismaClient) {
  const orderBy = { id: 'asc' as const };
  return {
    users: await db.user.findMany({ orderBy }), events: await db.event.findMany({ orderBy }),
    seats: await db.seat.findMany({ orderBy }), bookings: await db.booking.findMany({ orderBy }),
  };
}

async function withDatabase(run: (db: PrismaClient, url: string) => Promise<void>) {
  const name = 'seatbook_seed_' + randomUUID().replaceAll('-', '');
  const target = new URL(base);
  target.pathname = '/' + name;
  const url = target.toString();
  assertFixture(url);
  await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const migrated = cli(url);
    expect(migrated.status, migrated.stdout + migrated.stderr).toBe(0);
    await run(db, url);
  } finally {
    await db.$disconnect();
    // Generated fixture databases exist only in the verified isolated service.
    assertFixture(url);
    await admin.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
  }
}

async function expectComplete(db: PrismaClient) {
  const data = await snapshot(db);
  expect(data.users).toHaveLength(3);
  expect(data.events).toHaveLength(3);
  expect(data.seats).toHaveLength(79);
  expect(data.bookings).toHaveLength(4);
  expect(data.users.map((user) => [user.email, user.role])).toEqual([
    ['organizer@seatbook.test', 'ORGANIZER'], ['alice@seatbook.test', 'ATTENDEE'], ['bob@seatbook.test', 'ATTENDEE'],
  ]);
  for (const user of data.users) expect(await bcrypt.compare('password123', user.passwordHash)).toBe(true);
  const talk = data.events.find((event) => event.title === 'Postgres in Practice')!;
  const workshop = data.events.find((event) => event.title === 'Design Systems Workshop')!;
  const past = data.events.find((event) => event.title === 'Intro to TypeScript')!;
  expect([talk.rows, talk.cols, talk.priceCents]).toEqual([5, 8, 1500]);
  expect([workshop.rows, workshop.cols, workshop.priceCents]).toEqual([4, 6, 4000]);
  expect([past.rows, past.cols, past.priceCents]).toEqual([3, 5, 0]);
  const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  expect(talk.startsAt > clock.now && workshop.startsAt > clock.now && past.startsAt < clock.now).toBe(true);
  expect(data.bookings.map((row) => [data.seats.find((seat) => seat.id === row.seatId)!.label, row.status])).toEqual([
    ['A1', 'CONFIRMED'], ['A2', 'CONFIRMED'], ['A3', 'CANCELLED'], ['A4', 'CONFIRMED'],
  ]);
  expect(data.bookings.every((row) => (row.status === 'CANCELLED') === (row.cancelledAt !== null))).toBe(true);
  return data;
}

beforeAll(async () => {
  const [identity] = await admin.$queryRaw<{ database: string; username: string }[]>`
    SELECT current_database() AS database, current_user AS username`;
  expect(identity).toEqual({ database: 'seatbook_test', username: 'seatbook_test' });
});
afterAll(() => admin.$disconnect());

describe('atomic, non-destructive demo initialization on isolated PostgreSQL', () => {
  it('creates every demo account, event, seat grid and booking through the real CLI', async () => {
    await withDatabase(async (db, url) => {
      const result = cli(url, true);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('Seeded users, events and bookings');
      await expectComplete(db);
    });
  });

  it('repeats without changing IDs, hashes, timestamps, dates or reservations', async () => {
    await withDatabase(async (db) => {
      expect(await seedDatabase(db)).toBe('seeded');
      const before = await snapshot(db);
      expect(await seedDatabase(db)).toBe('existing-data');
      expect(await snapshot(db)).toEqual(before);
    });
  });

  it('preserves customer edits, cancelled bookings and active holds on subsequent runs', async () => {
    await withDatabase(async (db) => {
      await seedDatabase(db);
      const alice = await db.user.findUniqueOrThrow({ where: { email: 'alice@seatbook.test' } });
      const passwordHash = await bcrypt.hash('changed-customer-password', 10);
      await db.user.update({ where: { id: alice.id }, data: { name: 'Customer-edited name', passwordHash } });
      const talk = await db.event.findFirstOrThrow({ where: { title: 'Postgres in Practice' } });
      await db.event.update({ where: { id: talk.id }, data: { title: 'Customer-edited event', startsAt: new Date('2099-01-01T00:00:00Z'), priceCents: 999 } });
      const booking = await db.booking.findFirstOrThrow({ where: { userId: alice.id, status: 'CONFIRMED' } });
      await db.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      const seat = await db.seat.findFirstOrThrow({ where: { eventId: talk.id, col: 3, row: 0 } });
      const [instant] = await db.$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS now`;
      await db.booking.create({ data: { seatId: seat.id, userId: alice.id, status: 'HELD', createdAt: instant.now, expiresAt: new Date(instant.now.getTime() + 600_000) } });
      const before = await snapshot(db);
      expect(await seedDatabase(db)).toBe('existing-data');
      expect(await snapshot(db)).toEqual(before);
    });
  });

  it('does not overwrite an existing account that happens to use a demo email', async () => {
    await withDatabase(async (db) => {
      await db.user.create({ data: { email: 'organizer@seatbook.test', role: 'ATTENDEE', name: 'Existing customer', passwordHash: 'existing-private-hash' } });
      const before = await snapshot(db);
      expect(await seedDatabase(db)).toBe('existing-data');
      expect(await snapshot(db)).toEqual(before);
    });
  });

  it('preserves legacy partial data and explicitly declines to claim demo completeness', async () => {
    await withDatabase(async (db, url) => {
      await db.user.create({ data: { email: 'alice@seatbook.test', name: 'Existing partial demo', passwordHash: await bcrypt.hash('password123', 10) } });
      const before = await snapshot(db);
      const result = cli(url, true);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('Existing data found');
      expect(result.stdout).toContain('Demo completeness was not verified');
      expect(result.stdout).not.toContain('Database already seeded');
      expect(await snapshot(db)).toEqual(before);
    });
  });

  it('rolls back a late database failure and permits a complete retry', async () => {
    await withDatabase(async (db, url) => {
      await db.$executeRawUnsafe(`CREATE FUNCTION seed_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status = 'CANCELLED' THEN RAISE EXCEPTION 'synthetic seed failure'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER seed_fail BEFORE INSERT ON "Booking" FOR EACH ROW EXECUTE FUNCTION seed_fail()');
      const failed = cli(url, true);
      expect(failed.status, failed.stdout + failed.stderr).toBe(1);
      expect(failed.stderr).toContain('synthetic seed failure');
      expect(await snapshot(db)).toEqual({ users: [], events: [], seats: [], bookings: [] });
      await db.$executeRawUnsafe('DROP FUNCTION seed_fail() CASCADE');
      const retried = cli(url, true);
      expect(retried.status, retried.stdout + retried.stderr).toBe(0);
      await expectComplete(db);
    });
  });

  it('serializes independent concurrent initializers into one complete dataset', async () => {
    await withDatabase(async (db, url) => {
      const other = new PrismaClient({ datasources: { db: { url } } });
      try {
        expect((await Promise.all([seedDatabase(db), seedDatabase(other)])).sort()).toEqual(['existing-data', 'seeded']);
        await expectComplete(db);
      } finally { await other.$disconnect(); }
    });
  });

  it('rolls back an interrupted database session and recovers through the real CLI', async () => {
    await withDatabase(async (db, url) => {
      assertFixture(url);
      const blocker = new PrismaClient({ datasources: { db: { url } } });
      const seeder = new PrismaClient({ datasources: { db: { url } } });
      let unlock!: () => void, locked!: () => void;
      const gate = new Promise<void>((done) => { unlock = done; });
      const ready = new Promise<void>((done) => { locked = done; });
      await db.$executeRawUnsafe(`CREATE FUNCTION seed_pause() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(736543, 2); RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER seed_pause BEFORE INSERT ON "Booking" FOR EACH ROW EXECUTE FUNCTION seed_pause()');
      const held = blocker.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(736543, 2)`;
        locked();
        await gate;
      }, { timeout: 15_000 });
      try {
        await Promise.race([ready, held]);
        const attempt = seedDatabase(seeder).then(() => false, () => true);
        let pid: number | undefined;
        const deadline = Date.now() + 5000;
        while (!pid && Date.now() < deadline) {
          const rows = await db.$queryRaw<{ pid: number }[]>`
            SELECT a.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE l.locktype = 'advisory' AND l.classid = 736543 AND l.objid = 2 AND NOT l.granted
              AND a.datname = current_database() AND a.usename = current_user`;
          pid = rows[0]?.pid;
          if (!pid) await new Promise((done) => setTimeout(done, 20));
        }
        expect(pid).toBeTypeOf('number');
        // All prior users/events/seats are still uncommitted and invisible.
        expect(await snapshot(db)).toEqual({ users: [], events: [], seats: [], bookings: [] });
        // Terminate only this generated fixture's verified waiting session.
        assertFixture(url);
        const rows = await db.$queryRaw<{ terminated: boolean }[]>`
          SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
          WHERE pid = ${pid!} AND datname = current_database() AND usename = current_user`;
        expect(rows).toEqual([{ terminated: true }]);
        expect(await attempt).toBe(true);
        expect(await snapshot(db)).toEqual({ users: [], events: [], seats: [], bookings: [] });
      } finally {
        unlock();
        await held;
        await blocker.$disconnect();
        await seeder.$disconnect();
      }
      await db.$executeRawUnsafe('DROP FUNCTION seed_pause() CASCADE');
      const retried = cli(url, true);
      expect(retried.status, retried.stdout + retried.stderr).toBe(0);
      await expectComplete(db);
    });
  }, 30_000);
});
