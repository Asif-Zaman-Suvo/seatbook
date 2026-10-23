import { useEffect, useState } from 'react';

export interface ServerClock { serverMs: number; receivedAt: number; roundTripMs: number; }

export function serverClock(serverTime: string, startedAt: number, receivedAt = performance.now()): ServerClock {
  const serverMs = Date.parse(serverTime);
  if (!Number.isFinite(serverMs)) throw new Error('Seatbook returned an invalid server time. Please refresh.');
  return { serverMs, receivedAt, roundTripMs: Math.max(0, receivedAt - startedAt) };
}

export function remainingMs(deadline: string, clock: ServerClock, now = performance.now()): number {
  // Subtract the whole request duration conservatively: transport time must not
  // extend the displayed deadline. Browser wall-clock edits cannot reset it.
  return Math.max(0, Date.parse(deadline) - clock.serverMs - clock.roundTripMs - Math.max(0, now - clock.receivedAt)) || 0;
}

export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useMonotonicNow(enabled = true) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}
