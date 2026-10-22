import { describe, expect, it } from 'vitest';
import { credentials, eventInput, identifier, registration } from '../src/validation';

const now = new Date('2026-10-22T00:00:00Z');
const validEvent = { title: 'Talk', venue: 'Dhaka', startsAt: '2027-01-10T18:00:00.000Z', rows: 2, cols: 3, priceCents: 0 };

describe('request validation', () => {
  it('normalizes email, trims names, and preserves passwords', () => {
    const value = registration({ email: ' Alice@Seatbook.Test ', name: ' Alice ', password: 'long password with space ', role: 'ORGANIZER' });
    expect(value).toEqual({ email: 'alice@seatbook.test', name: 'Alice', password: 'long password with space ', role: 'ORGANIZER' });
  });

  it.each([null, [], {}, { email: 5, password: 'password' }, { email: 'bad', password: 'password' }, { email: 'a@b.test', password: 42 }])('rejects malformed credentials: %j', (value) => {
    expect(() => credentials(value)).toThrow();
  });

  it('rejects short registration passwords, bcrypt byte truncation, and unknown roles', () => {
    const body = { email: 'a@b.test', name: 'Name', password: 'a'.repeat(12) };
    expect(() => registration({ ...body, password: 'short' })).toThrow();
    expect(() => registration({ ...body, password: '🔒'.repeat(19) })).toThrow();
    expect(() => registration({ ...body, role: 'ADMIN' })).toThrow();
    // Existing demo accounts can still log in with their original passwords.
    expect(credentials({ email: body.email, password: 'password123' }).password).toBe('password123');
  });

  it.each(['0', '-1', '1junk', '1.5', ' 1', '2147483648', '1e2'])('rejects invalid ID %s', (id) => {
    expect(() => identifier(id)).toThrow();
  });

  it.each(['a'.repeat(73), '🔒'.repeat(19), 'a'.repeat(32768)])('preserves long legacy login inputs (%#)', (password) => {
    expect(credentials({ email: 'a@b.test', password }).password).toBe(password);
    expect(() => registration({ email: 'a@b.test', name: 'Alice', password })).toThrow();
  });

  it('bounds login input by the API byte budget, including multibyte inputs', () => {
    for (const password of ['', 'a'.repeat(32769), '🔒'.repeat(8193)]) {
      expect(() => credentials({ email: 'a@b.test', password })).toThrow();
    }
  });

  it('accepts a bounded grid and free tickets', () => {
    expect(eventInput(validEvent, now)).toMatchObject({ rows: 2, cols: 3, priceCents: 0, description: '' });
  });

  it.each([
    { rows: -1 }, { rows: 0 }, { rows: 27 }, { rows: 1.5 }, { rows: '2' },
    { cols: 31 }, { priceCents: -1 }, { priceCents: 1.2 }, { priceCents: null },
    { title: ' ' }, { venue: 42 }, { description: 'x'.repeat(5001) },
    { startsAt: 'not-a-date' }, { startsAt: '2027-02-30T10:00:00Z' },
    { startsAt: '2027-01-10T24:00:00Z' }, { startsAt: '2027-01-10T10:00:00' },
    { startsAt: '2026-10-22T00:00:00Z' },
  ])('rejects invalid event fields: %j', (override) => {
    expect(() => eventInput({ ...validEvent, ...override }, now)).toThrow();
  });
});
