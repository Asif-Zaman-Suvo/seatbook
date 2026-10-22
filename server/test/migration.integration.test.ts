import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// integrationSetup also guards the target before importing any Prisma client.
const base = new URL(process.env.TEST_DATABASE_URL!);
if (base.pathname !== '/seatbook_test' || base.username !== 'seatbook_test') {
  throw new Error('Migration tests require the disposable seatbook_test database/user');
}
const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
const migration = '20261022000000_booking_integrity';
let baseline: string;

beforeAll(() => {
  baseline = mkdtempSync(join(tmpdir(), 'seatbook-baseline-'));
  mkdirSync(join(baseline, 'migrations'));
  cpSync(resolve('prisma/schema.prisma'), join(baseline, 'schema.prisma'));
  cpSync(resolve('prisma/migrations/migration_lock.toml'), join(baseline, 'migrations/migration_lock.toml'));
  // Deploy the original migration, not db push or a hand-recreated approximation.
  cpSync(resolve('prisma/migrations/20261001000000_init'), join(baseline, 'migrations/20261001000000_init'), { recursive: true });
});

afterAll(async () => {
  await admin.$disconnect();
  if (baseline) rmSync(baseline, { recursive: true, force: true });
});

function cli(url: string, args: string[], schema = resolve('prisma/schema.prisma')) {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', ...args, '--schema', schema], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

async function snapshot(db: PrismaClient) {
  const orderBy = { id: 'asc' as const };
  return {
    users: await db.user.findMany({ orderBy }), events: await db.event.findMany({ orderBy }),
    seats: await db.seat.findMany({ orderBy }), bookings: await db.booking.findMany({ orderBy }),
  };
}

async function fixture(db: PrismaClient) {
  const organizer = await db.user.create({ data: { email: ' Organizer@Example.Test ', name: 'Organizer', role: 'ORGANIZER', passwordHash: 'fixture-organizer-hash' } });
  const alice = await db.user.create({ data: { email: ' Alice@Example.Test ', name: 'Alice', passwordHash: 'fixture-alice-hash' } });
  const bob = await db.user.create({ data: { email: 'bob@example.test', name: 'Bob', passwordHash: 'fixture-bob-hash' } });
  const event = await db.event.create({ data: {
    title: 'Existing event', description: 'Existing content', venue: 'Dhaka',
    startsAt: new Date('2099-01-01T18:00:00Z'), rows: 1, cols: 2, priceCents: 1500, organizerId: organizer.id,
    seats: { create: [{ row: 0, col: 0, label: 'A1' }, { row: 0, col: 1, label: 'A2' }] },
  }, include: { seats: { orderBy: { col: 'asc' } } } });
  const past = await db.event.create({ data: {
    title: 'Historical event', description: 'History', venue: 'Dhaka',
    startsAt: new Date('2020-01-01T18:00:00Z'), rows: 1, cols: 1, priceCents: 0, organizerId: organizer.id,
    seats: { create: [{ row: 0, col: 0, label: 'A1' }] },
  }, include: { seats: true } });
  const booking = await db.booking.create({ data: { seatId: event.seats[0].id, userId: alice.id, createdAt: new Date('2026-09-01T01:00:00Z') } });
  for (const userId of [alice.id, bob.id]) {
    await db.booking.create({ data: {
      seatId: event.seats[0].id, userId, status: 'CANCELLED',
      createdAt: new Date('2026-08-01T01:00:00Z'), cancelledAt: new Date('2026-08-02T02:00:00Z'),
    } });
  }
  await db.booking.create({ data: { seatId: past.seats[0].id, userId: bob.id, createdAt: new Date('2019-12-01T01:00:00Z') } });
  return { alice, bob, event, booking };
}

async function withLegacyDatabase(run: (db: PrismaClient, url: string, data: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  // Only generated fixture names can enter the unavoidable CREATE DATABASE SQL.
  const name = `seatbook_migration_${randomUUID().replaceAll('-', '')}`;
  if (!/^seatbook_migration_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid fixture database name');
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(base);
  target.pathname = `/${name}`;
  const url = target.toString();
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const initial = cli(url, ['deploy'], join(baseline, 'schema.prisma'));
    expect(initial.status, initial.output).toBe(0);
    await run(db, url, await fixture(db));
  } finally {
    await db.$disconnect();
    // These databases exist only in the isolated test service, never the app DB.
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
}

function normalized(before: Awaited<ReturnType<typeof snapshot>>) {
  return { ...before, users: before.users.map((user) => ({ ...user, email: user.email.trim().toLowerCase() })) };
}

describe('populated database migration through Prisma CLI', () => {
  it('preserves all bookings, identities, hashes, dates and relationships; redeploys idempotently', async () => {
    await withLegacyDatabase(async (db, url, data) => {
      const before = await snapshot(db);
      const deployed = cli(url, ['deploy']);
      expect(deployed.status, deployed.output).toBe(0);
      expect(await snapshot(db)).toEqual(normalized(before));
      const redeployed = cli(url, ['deploy']);
      expect(redeployed.status, redeployed.output).toBe(0);
      expect(await snapshot(db)).toEqual(normalized(before));
      await expect(db.booking.create({ data: { seatId: data.event.seats[0].id, userId: data.bob.id } })).rejects.toMatchObject({ code: 'P2002' });
      expect(await snapshot(db)).toEqual(normalized(before));
    });
  }, 60_000);

  it.each([
    { kind: 'duplicate booking', diagnostic: 'Multiple confirmed bookings exist for a seat' },
    { kind: 'email collision', diagnostic: 'Email addresses collide after normalization' },
    { kind: 'invalid grid', diagnostic: 'Event_grid_bounds' },
    { kind: 'negative price', diagnostic: 'Event_price_nonnegative' },
    { kind: 'invalid seat', diagnostic: 'Seat_coordinates_bounds' },
    { kind: 'invalid cancellation', diagnostic: 'Booking_cancellation_consistent' },
  ])('reports $kind, rolls back every change, blocks retries and recovers without deleting rows', async ({ kind, diagnostic }) => {
    await withLegacyDatabase(async (db, url, data) => {
      let reconcile: () => Promise<unknown>;
      if (kind === 'duplicate booking') {
        const duplicate = await db.booking.create({ data: { seatId: data.event.seats[0].id, userId: data.bob.id } });
        reconcile = () => db.booking.update({ where: { id: duplicate.id }, data: { status: 'CANCELLED', cancelledAt: new Date('2026-10-22T00:00:00Z') } });
      } else if (kind === 'email collision') {
        const collision = await db.user.create({ data: { email: 'alice@example.test', name: 'Collision', passwordHash: 'fixture-collision-hash' } });
        reconcile = () => db.user.update({ where: { id: collision.id }, data: { email: 'reconciled@example.test' } });
      } else if (kind === 'invalid grid') {
        await db.event.update({ where: { id: data.event.id }, data: { rows: -1 } });
        reconcile = () => db.event.update({ where: { id: data.event.id }, data: { rows: 1 } });
      } else if (kind === 'negative price') {
        await db.event.update({ where: { id: data.event.id }, data: { priceCents: -1 } });
        reconcile = () => db.event.update({ where: { id: data.event.id }, data: { priceCents: 1500 } });
      } else if (kind === 'invalid seat') {
        await db.seat.update({ where: { id: data.event.seats[0].id }, data: { row: -1 } });
        reconcile = () => db.seat.update({ where: { id: data.event.seats[0].id }, data: { row: 0 } });
      } else {
        await db.booking.update({ where: { id: data.booking.id }, data: { cancelledAt: new Date('2026-10-22T00:00:00Z') } });
        reconcile = () => db.booking.update({ where: { id: data.booking.id }, data: { cancelledAt: null } });
      }

      const before = await snapshot(db);
      const failed = cli(url, ['deploy']);
      expect(failed.status).not.toBe(0);
      expect(failed.output).toContain(diagnostic);
      expect(failed.output).not.toContain('current transaction is aborted');
      expect(await snapshot(db)).toEqual(before);
      // Even late CHECK failures must roll back email normalization and earlier DDL.
      expect(await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'Booking_one_confirmed_per_seat'`).toEqual([]);
      expect(await db.$queryRaw`SELECT conname FROM pg_constraint WHERE conname = 'User_email_normalized'`).toEqual([]);
      const records = await db.$queryRaw<Array<{ logs: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT logs, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${migration}`;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ finished_at: null, rolled_back_at: null });
      expect(records[0].logs).toContain(diagnostic);

      const blocked = cli(url, ['deploy']);
      expect(blocked.status).not.toBe(0);
      expect(blocked.output).toContain('P3009');
      expect(await snapshot(db)).toEqual(before);

      // Deliberately reconcile only synthetic invalid fixtures; no automatic winner
      // selection, account merging, or record deletion belongs in the migration.
      await reconcile();
      const reconciled = await snapshot(db);
      const resolved = cli(url, ['resolve', '--rolled-back', migration]);
      expect(resolved.status, resolved.output).toBe(0);
      expect(await snapshot(db)).toEqual(reconciled); // resolve changes metadata only
      const recovered = cli(url, ['deploy']);
      expect(recovered.status, recovered.output).toBe(0);
      expect(await snapshot(db)).toEqual(normalized(reconciled));
      expect((await db.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM "_prisma_migrations"
        WHERE migration_name = ${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`)[0].count).toBe(1);
      await expect(db.booking.create({ data: { seatId: data.event.seats[0].id, userId: data.bob.id } })).rejects.toMatchObject({ code: 'P2002' });
    });
  }, 60_000);
});
