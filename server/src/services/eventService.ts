import { Prisma } from '@prisma/client';
import prisma from '../db';
import { formatPrice, isSeatBookable } from '../utils/helpers';
import { databaseTime } from './seatTransaction';

const reservations = {
  where: { status: { in: ['CONFIRMED', 'HELD'] as ('CONFIRMED' | 'HELD')[] } },
  select: { status: true, expiresAt: true },
};

export async function listEvents() {
  return prisma.$transaction(async (tx) => {
    const now = await databaseTime(tx);
    const events = await tx.event.findMany({
      orderBy: { startsAt: 'asc' },
      include: { seats: { select: { bookings: reservations } } },
    });

    return events.map((event) => {
      const seatsLeft = event.seats.filter((seat) => isSeatBookable(seat, event, now)).length;
      return {
        id: event.id,
        title: event.title,
        venue: event.venue,
        startsAt: event.startsAt,
        price: formatPrice(event.priceCents),
        priceCents: event.priceCents,
        totalSeats: event.seats.length,
        seatsLeft,
        serverTime: now,
      };
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function getEventWithSeats(id: number) {
  return prisma.$transaction(async (tx) => {
    const serverTime = await databaseTime(tx);
    const event = await tx.event.findUnique({
      where: { id },
      include: {
        organizer: { select: { id: true, name: true } },
        seats: {
          orderBy: [{ row: 'asc' }, { col: 'asc' }],
          include: { bookings: reservations },
        },
      },
    });
    return event ? { ...event, serverTime } : null;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
