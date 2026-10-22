import { Prisma } from '@prisma/client';
import prisma from '../db';
import { HttpError } from '../http';

export async function databaseTime(tx: Prisma.TransactionClient): Promise<Date> {
  // Match Prisma's millisecond precision and naive UTC timestamp columns.
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`
    SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
  return clock.now;
}

export async function expireSeatHolds(tx: Prisma.TransactionClient, seatId: number, now: Date) {
  await tx.booking.updateMany({
    where: { seatId, status: 'HELD', expiresAt: { lte: now } }, data: { status: 'EXPIRED' },
  });
}

export async function seatTransaction<T>(seatId: number, work: (tx: Prisma.TransactionClient, now: Date) => Promise<T | HttpError>): Promise<T> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
    const seats = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Seat" WHERE "id" = ${seatId} FOR UPDATE`;
    if (!seats.length) throw new HttpError(404, 'SEAT_NOT_FOUND', 'Seat not found');
    // Read time after waiting for the lock, never at transaction start.
    const now = await databaseTime(tx);
    await expireSeatHolds(tx, seatId, now);
    return work(tx, now);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 });
  // Expected rejections commit expiry reconciliation. Unexpected failures throw
  // within the transaction and roll back all changes, including reconciliation.
  if (result instanceof HttpError) throw result;
  return result;
}
