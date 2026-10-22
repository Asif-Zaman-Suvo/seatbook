import prisma from '../db';
import { formatPrice, isSeatBookable } from '../utils/helpers';

export async function listEvents() {
  const events = await prisma.event.findMany({
    orderBy: { startsAt: 'asc' },
    include: { seats: { select: { bookings: { where: { status: 'CONFIRMED' }, select: { status: true } } } } },
  });

  const now = new Date();
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
    };
  });
}

export async function getEventWithSeats(id: number) {
  return prisma.event.findUnique({
    where: { id },
    include: {
      organizer: { select: { id: true, name: true } },
      seats: {
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
        include: { bookings: { where: { status: 'CONFIRMED' }, select: { status: true } } },
      },
    },
  });
}
