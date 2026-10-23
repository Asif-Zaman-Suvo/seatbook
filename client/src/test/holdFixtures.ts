import { ActiveHold, EventDetail } from '../types';

export const testServerTime = '2026-10-23T12:00:00.000Z';
export const attendee = { id: 1, email: 'alice@example.com', name: 'Alice', role: 'ATTENDEE' as const };
export const testEvent: EventDetail = {
  id: 1, title: 'Test workshop', description: 'A workshop in Dhaka', venue: 'Dhaka', startsAt: '2099-01-01T00:00:00.000Z',
  priceCents: 1500, price: '$15.00', rows: 1, cols: 3, organizer: { id: 2, name: 'Organizer' }, serverTime: testServerTime,
  seats: [
    { id: 10, row: 0, col: 0, label: 'A1', available: true, status: 'AVAILABLE', holdExpiresAt: null },
    { id: 11, row: 0, col: 1, label: 'A2', available: false, status: 'HELD', holdExpiresAt: '2026-10-23T12:05:00.000Z' },
    { id: 12, row: 0, col: 2, label: 'A3', available: false, status: 'BOOKED', holdExpiresAt: null },
  ],
};

export function testHold(id = 41, remaining = 600_000, event = testEvent): ActiveHold {
  const expiresAt = new Date(Date.parse(testServerTime) + remaining).toISOString();
  return {
    id, seatId: event.seats[0].id, status: 'HELD', expiresAt,
    createdAt: new Date(Date.parse(expiresAt) - 600_000).toISOString(),
    seat: { id: event.seats[0].id, label: event.seats[0].label, row: 0, col: 0,
      event: { id: event.id, title: event.title, venue: event.venue, startsAt: event.startsAt } },
  };
}
