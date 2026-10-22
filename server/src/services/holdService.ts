import { Booking, Prisma } from '@prisma/client';
import prisma from '../db';
import { HttpError } from '../http';
import { databaseTime, expireSeatHolds, seatTransaction } from './seatTransaction';

function holdView(hold: Booking) {
  return { id: hold.id, seatId: hold.seatId, status: hold.status, createdAt: hold.createdAt, expiresAt: hold.expiresAt! };
}

async function ownedHold(userId: number, id: number) {
  const hold = await prisma.booking.findFirst({ where: { id, userId, expiresAt: { not: null } }, select: { seatId: true } });
  if (!hold) throw new HttpError(404, 'HOLD_NOT_FOUND', 'Hold not found');
  return hold;
}

function inactiveHold(hold: Booking): HttpError {
  return hold.status === 'EXPIRED'
    ? new HttpError(409, 'HOLD_EXPIRED', 'This hold has expired')
    : new HttpError(409, 'HOLD_NOT_ACTIVE', 'This hold is no longer active');
}

export async function createHold(userId: number, seatId: number) {
  return seatTransaction(seatId, async (tx, now) => {
    const seat = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, include: { event: true } });
    if (seat.event.startsAt <= now) return new HttpError(409, 'EVENT_STARTED', 'This event has already started');
    const existing = await tx.booking.findFirst({ where: { seatId, status: { in: ['HELD', 'CONFIRMED'] } } });
    if (existing) {
      if (existing.status === 'HELD' && existing.userId === userId) {
        return { created: false, hold: holdView(existing), serverTime: now };
      }
      return new HttpError(409, 'SEAT_UNAVAILABLE', 'Seat is already held or booked');
    }

    // One database clock sample supplies both persisted timestamps. No client or
    // application clock determines the deadline; retries return the existing row.
    const [hold] = await tx.$queryRaw<Booking[]>`
      WITH instant AS MATERIALIZED (
        SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS "now"
      )
      INSERT INTO "Booking" ("seatId", "userId", "status", "createdAt", "expiresAt")
      SELECT ${seatId}, ${userId}, 'HELD', instant."now", instant."now" + INTERVAL '10 minutes'
      FROM instant
      WHERE EXISTS (SELECT 1 FROM "Seat" s JOIN "Event" e ON e.id = s."eventId"
                    WHERE s.id = ${seatId} AND e."startsAt" > instant."now")
      RETURNING *`;
    if (!hold) return new HttpError(409, 'EVENT_STARTED', 'This event has already started');
    return { created: true, hold: holdView(hold), serverTime: hold.createdAt };
  });
}

export async function activeHolds(userId: number) {
  return prisma.$transaction(async (tx) => {
    const serverTime = await databaseTime(tx);
    const holds = await tx.booking.findMany({
      where: { userId, status: 'HELD', expiresAt: { gt: serverTime }, seat: { event: { startsAt: { gt: serverTime } } } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      include: { seat: { select: { id: true, label: true, row: true, col: true, event: { select: { id: true, title: true, venue: true, startsAt: true } } } } },
    });
    return { holds: holds.map((hold) => ({ ...holdView(hold), seat: hold.seat })), serverTime };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function confirmHold(userId: number, id: number) {
  const owned = await ownedHold(userId, id);
  return seatTransaction(owned.seatId, async (tx, now) => {
    const hold = await tx.booking.findFirst({ where: { id, userId, expiresAt: { not: null } } });
    if (!hold) return new HttpError(404, 'HOLD_NOT_FOUND', 'Hold not found');
    // A lost successful response can be retried, even after the former deadline.
    // Cancellation is terminal: a retry must never resurrect a cancelled booking.
    if (hold.status === 'CONFIRMED') return { booking: hold, hold: holdView(hold), serverTime: now };
    if (hold.status !== 'HELD') return inactiveHold(hold);

    // Check time again in the UPDATE itself, after all lock waits/queries. The
    // strict > predicate rejects an exactly expired hold at the state transition.
    const [confirmed] = await tx.$queryRaw<(Booking & { serverTime: Date })[]>`
      WITH instant AS MATERIALIZED (
        SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS "now"
      )
      UPDATE "Booking" b SET "status" = 'CONFIRMED'
      FROM "Seat" s JOIN "Event" e ON e.id = s."eventId", instant
      WHERE b.id = ${id} AND b."userId" = ${userId} AND b."status" = 'HELD'
        AND s.id = b."seatId" AND b."expiresAt" > instant."now" AND e."startsAt" > instant."now"
      RETURNING b.*, instant."now" AS "serverTime"`;
    if (!confirmed) {
      const current = await databaseTime(tx);
      await expireSeatHolds(tx, owned.seatId, current);
      return hold.expiresAt! <= current
        ? new HttpError(409, 'HOLD_EXPIRED', 'This hold has expired')
        : new HttpError(409, 'EVENT_STARTED', 'This event has already started');
    }
    const { serverTime, ...booking } = confirmed;
    return { booking, hold: holdView(booking), serverTime };
  });
}

export async function releaseHold(userId: number, id: number) {
  const owned = await ownedHold(userId, id);
  return seatTransaction(owned.seatId, async (tx, now) => {
    const hold = await tx.booking.findFirst({ where: { id, userId, expiresAt: { not: null } } });
    if (!hold) return new HttpError(404, 'HOLD_NOT_FOUND', 'Hold not found');
    if (hold.status === 'RELEASED') return { hold: holdView(hold), serverTime: now };
    if (hold.status !== 'HELD') return inactiveHold(hold);
    const released = await tx.booking.update({ where: { id }, data: { status: 'RELEASED' } });
    return { hold: holdView(released), serverTime: now };
  });
}
