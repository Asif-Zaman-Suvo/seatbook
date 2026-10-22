import { BookingStatus } from '@prisma/client';

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function seatLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

export function isSeatBookable(seat: { bookings: { status: BookingStatus }[] }, event: { startsAt: Date }, now = new Date()): boolean {
  if (event.startsAt <= now) {
    return false;
  }
  return !seat.bookings.some((booking) => booking.status === 'CONFIRMED');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
