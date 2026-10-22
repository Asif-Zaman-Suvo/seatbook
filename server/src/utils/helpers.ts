import { BookingStatus } from '@prisma/client';

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function seatLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

type SeatReservations = { bookings: { status: BookingStatus; expiresAt?: Date | null }[] };

export function seatAvailability(seat: SeatReservations, event: { startsAt: Date }, now: Date) {
  if (event.startsAt <= now) return { status: 'CLOSED' as const, holdExpiresAt: null };
  if (seat.bookings.some((booking) => booking.status === 'CONFIRMED')) return { status: 'BOOKED' as const, holdExpiresAt: null };
  const hold = seat.bookings.find((booking) => booking.status === 'HELD' && booking.expiresAt && booking.expiresAt > now);
  return hold ? { status: 'HELD' as const, holdExpiresAt: hold.expiresAt! } : { status: 'AVAILABLE' as const, holdExpiresAt: null };
}

export function isSeatBookable(seat: SeatReservations, event: { startsAt: Date }, now: Date): boolean {
  return seatAvailability(seat, event, now).status === 'AVAILABLE';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
