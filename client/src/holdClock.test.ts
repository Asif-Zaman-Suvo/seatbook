import { expect, it, vi } from 'vitest';
import { countdown, remainingMs, serverClock } from './holdClock';

const start = '2026-10-23T12:00:00.000Z';
const end = '2026-10-23T12:10:00.000Z';

it('anchors to server time and advances using elapsed monotonic time', () => {
  const clock = serverClock(start, 100, 100);
  expect(remainingMs(end, clock, 100)).toBe(600_000);
  expect(remainingMs(end, clock, 61_100)).toBe(539_000);
  expect(countdown(remainingMs(end, clock, 61_100))).toBe('8:59');
});

it('does not reset a deadline when the browser wall clock changes', () => {
  const clock = serverClock(start, 0, 0);
  for (const wallClock of [0, Date.parse('2099-01-01'), Date.parse('2000-01-01')]) {
    vi.spyOn(Date, 'now').mockReturnValue(wallClock);
    expect(remainingMs(end, clock, 120_000)).toBe(480_000);
  }
});

it('subtracts transport time rather than adding it to the hold lifetime', () => {
  const clock = serverClock(start, 100, 2100);
  expect(remainingMs(end, clock, 2100)).toBe(598_000);
  expect(remainingMs(end, clock, 3100)).toBe(597_000);
});

it.each([-1, 0, 1])('clamps the deadline at a %d millisecond offset', (offset) => {
  const clock = serverClock(start, 0, 0);
  expect(remainingMs(end, clock, 600_000 + offset)).toBe(offset < 0 ? 1 : 0);
});

it('rounds the display up and never shows negative time', () => {
  expect(countdown(1)).toBe('0:01');
  expect(countdown(60_001)).toBe('1:01');
  expect(countdown(0)).toBe('0:00');
  expect(countdown(-100)).toBe('0:00');
});

it('rejects invalid server time and disables an invalid deadline', () => {
  expect(() => serverClock('invalid', 0, 0)).toThrow('invalid server time');
  expect(remainingMs('invalid', serverClock(start, 0, 0), 0)).toBe(0);
});
