import { Prisma } from '@prisma/client';
import prisma from '../db';
import { HttpError } from '../http';

const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 5000 };

async function lockSeat(tx: Prisma.TransactionClient, seatId: number) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
  const seats = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Seat" WHERE "id" = ${seatId} FOR UPDATE`;
  if (seats.length === 0) throw new HttpError(404, 'SEAT_NOT_FOUND', 'Seat not found');
}

export async function bookSeat(userId: number, seatId: number) {
  return prisma.$transaction(async (tx) => {
    // Lock the existing Seat; an absent Booking row cannot protect availability.
    await lockSeat(tx, seatId);
    const seat = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, include: { event: true } });
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
    if (seat.event.startsAt <= clock.now) throw new HttpError(409, 'EVENT_STARTED', 'This event has already started');
    const existing = await tx.booking.findFirst({ where: { seatId, status: 'CONFIRMED' }, select: { id: true } });
    if (existing) throw new HttpError(409, 'SEAT_UNAVAILABLE', 'Seat already booked');
    return tx.booking.create({ data: { seatId, userId, status: 'CONFIRMED' } });
  }, transactionOptions);
}

export async function cancelBooking(userId: number, id: number) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.booking.findFirst({ where: { id, userId }, select: { seatId: true } });
    if (!owned) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    await lockSeat(tx, owned.seatId);
    const booking = await tx.booking.findFirst({ where: { id, userId } });
    if (!booking) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.status === 'CANCELLED') return booking;
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
    return tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: clock.now } });
  }, transactionOptions);
}
