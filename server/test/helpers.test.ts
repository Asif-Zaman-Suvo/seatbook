import { describe, it, expect } from 'vitest';
import { formatPrice, isSeatBookable, seatLabel, slugify } from '../src/utils/helpers';

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

  it('labels seats by row letter and column number', () => {
    expect(seatLabel(0, 0)).toBe('A1');
    expect(seatLabel(2, 4)).toBe('C5');
  });

  it('slugifies titles', () => {
    expect(slugify('  Postgres in Practice! ')).toBe('postgres-in-practice');
  });
});
