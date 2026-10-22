import { describe, it, expect } from 'vitest';
import { formatPrice, isSeatBookable, seatAvailability, seatLabel, slugify } from '../src/utils/helpers';

describe('helpers', () => {
  it('ignores cancelled history but rejects confirmed seats and started events', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    const event = { startsAt: new Date(now.getTime() + 1) };
    expect(isSeatBookable({ bookings: [{ status: 'CANCELLED' }] }, event, now)).toBe(true);
    expect(isSeatBookable({ bookings: [{ status: 'CONFIRMED' }] }, event, now)).toBe(false);
    expect(isSeatBookable({ bookings: [] }, { startsAt: now }, now)).toBe(false);
  });
  it('formats cents as dollars', () => {
    expect(formatPrice(1500)).toBe('$15.00');
    expect(formatPrice(0)).toBe('$0.00');
  });

  it.each([-1, 0, 1])('uses a strict hold deadline at a %d ms offset', (offset) => {
    const now = new Date('2026-10-23T00:00:00Z');
    const seat = { bookings: [{ status: 'HELD' as const, expiresAt: new Date(now.getTime() + offset) }] };
    const event = { startsAt: new Date('2099-01-01T00:00:00Z') };
    expect(isSeatBookable(seat, event, now)).toBe(offset <= 0);
    expect(seatAvailability(seat, event, now).status).toBe(offset > 0 ? 'HELD' : 'AVAILABLE');
  });

  it.each(['EXPIRED', 'RELEASED', 'CANCELLED'] as const)('ignores %s reservation history', (status) => {
    const now = new Date('2026-10-23T00:00:00Z');
    expect(isSeatBookable({ bookings: [{ status, expiresAt: new Date('2099-01-01') }] }, { startsAt: new Date('2099-01-01') }, now)).toBe(true);
  });

  it('keeps confirmed reservations booked after their former hold deadline', () => {
    const now = new Date('2026-10-23T00:00:00Z');
    expect(seatAvailability({ bookings: [{ status: 'CONFIRMED', expiresAt: new Date('2020-01-01') }] }, { startsAt: new Date('2099-01-01') }, now).status).toBe('BOOKED');
  });

  it('closes started events even when a hold has remaining time', () => {
    const now = new Date('2026-10-23T00:00:00Z');
    expect(seatAvailability({ bookings: [{ status: 'HELD', expiresAt: new Date('2099-01-01') }] }, { startsAt: now }, now)).toEqual({ status: 'CLOSED', holdExpiresAt: null });
  });

  it('labels seats by row letter and column number', () => {
    expect(seatLabel(0, 0)).toBe('A1');
    expect(seatLabel(2, 4)).toBe('C5');
  });

  it('slugifies titles', () => {
    expect(slugify('  Postgres in Practice! ')).toBe('postgres-in-practice');
  });
});
