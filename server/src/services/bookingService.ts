import prisma from '../db';
import { HttpError } from '../http';
import { seatTransaction } from './seatTransaction';

export async function bookSeat(userId: number, seatId: number) {
  return seatTransaction(seatId, async (tx, now) => {
    const seat = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, include: { event: true } });
    if (seat.event.startsAt <= now) return new HttpError(409, 'EVENT_STARTED', 'This event has already started');
    const existing = await tx.booking.findFirst({ where: { seatId, status: { in: ['CONFIRMED', 'HELD'] } }, select: { status: true } });
    if (existing) return new HttpError(409, 'SEAT_UNAVAILABLE', existing.status === 'HELD' ? 'Seat is held. The owner must confirm the hold.' : 'Seat already booked');
    return tx.booking.create({ data: { seatId, userId, status: 'CONFIRMED' } });
  });
}

export async function cancelBooking(userId: number, id: number) {
  const where = { id, userId, status: { in: ['CONFIRMED', 'CANCELLED'] as ('CONFIRMED' | 'CANCELLED')[] } };
  const owned = await prisma.booking.findFirst({ where, select: { seatId: true } });
  if (!owned) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return seatTransaction(owned.seatId, async (tx, now) => {
    const booking = await tx.booking.findFirst({ where });
    if (!booking) return new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.status === 'CANCELLED') return booking;
    return tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now } });
  });
}
