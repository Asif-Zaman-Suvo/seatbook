import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from './api';
import { useUser } from './auth';
import { ActiveHold, ConfirmHoldResponse, EventDetail, HoldResponse, HoldsResponse, Seat } from './types';
import { remainingMs, ServerClock, serverClock, useMonotonicNow } from './holdClock';

export const availabilityChanged = 'seatbook-availability-change';
const notifyAvailability = () => window.dispatchEvent(new Event(availabilityChanged));
export interface TimedHold extends ActiveHold { clock: ServerClock; uncertain?: 'confirm' | 'release'; }
type Action = 'hold' | 'confirm' | 'release';
interface HoldState {
  token: string | null; holds: TimedHold[]; loaded: boolean; syncing: boolean;
  syncError: string; actionError: string; notice: string; pending: string | null; focusHoldId: number | null; uncertainCreation: boolean;
}
const emptyState = (token: string | null): HoldState => ({ token, holds: [], loaded: false, syncing: false, syncError: '', actionError: '', notice: '', pending: null, focusHoldId: null, uncertainCreation: false });
interface HoldContextValue extends HoldState {
  ready: boolean; now: number; refresh: () => Promise<void>;
  create: (seat: Seat, event: EventDetail) => Promise<boolean>;
  confirm: (hold: TimedHold) => Promise<boolean>; release: (hold: TimedHold) => Promise<boolean>;
}
const HoldContext = createContext<HoldContextValue | null>(null);

export function HoldProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const token = user ? localStorage.getItem('token') : null;
  const attendee = user?.role === 'ATTENDEE';
  const [state, setState] = useState<HoldState>(() => emptyState(token));
  const epoch = useRef(0);
  const sequence = useRef(0);
  const read = useRef<AbortController | null>(null);
  const session = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const expired = useRef(new Set<string>());
  const snapshot = useRef('');
  const now = useMonotonicNow(attendee);
  // Hide the previous identity synchronously, before effect cleanup runs.
  const visible = attendee && state.token === token ? state : emptyState(token);

  const refresh = useCallback(async () => {
    if (!attendee || !token || mutation.current) return;
    const generation = epoch.current;
    const revision = ++sequence.current;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const current = () => !controller.signal.aborted && generation === epoch.current && revision === sequence.current && localStorage.getItem('token') === token;
    setState((s) => ({ ...s, syncing: true }));
    const startedAt = performance.now();
    try {
      const data = await api<HoldsResponse>('/holds/mine', { signal: controller.signal }, true);
      if (!current()) return;
      const clock = serverClock(data.serverTime, startedAt);
      const signature = data.holds.map((hold) => `${hold.id}:${hold.expiresAt}:${hold.seat.event.startsAt}`).join(',');
      const changed = signature !== snapshot.current;
      snapshot.current = signature;
      setState((s) => {
        const holds = data.holds.map((hold) => ({ ...hold, clock, uncertain: s.holds.find((old) => old.id === hold.id)?.uncertain }));
        // A missing hold after a lost mutation response may already be booked or
        // released. Retain its explicit retry instead of inventing success.
        const uncertain = s.holds.filter((hold) => hold.uncertain && !holds.some((fresh) => fresh.id === hold.id));
        return { ...s, holds: [...holds, ...uncertain], loaded: true, syncing: false, syncError: '', uncertainCreation: false,
          actionError: s.uncertainCreation ? '' : s.actionError, notice: s.uncertainCreation ? 'Your seat hold status was refreshed.' : s.notice };
      });
      if (changed) notifyAvailability();
    } catch (error) {
      if (!current()) return;
      setState((s) => ({ ...s, syncing: false, syncError: errorMessage(error), holds: error instanceof ApiError && error.status === 403 ? [] : s.holds }));
    }
  }, [attendee, token]);

  useEffect(() => {
    ++epoch.current;
    session.current = new AbortController();
    mutation.current = false;
    expired.current.clear();
    snapshot.current = '';
    setState(emptyState(token));
    if (attendee && token) void refresh();
    const sync = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(sync, 15_000);
    for (const event of ['focus', 'pageshow', 'online']) window.addEventListener(event, sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      ++epoch.current;
      read.current?.abort();
      session.current?.abort();
      window.clearInterval(timer);
      for (const event of ['focus', 'pageshow', 'online']) window.removeEventListener(event, sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [attendee, token, refresh]);

  useEffect(() => {
    const due = visible.holds.filter((hold) => !hold.uncertain && (
      remainingMs(hold.expiresAt, hold.clock, now) === 0 || remainingMs(hold.seat.event.startsAt, hold.clock, now) === 0
    ) && !expired.current.has(`${hold.id}:${hold.expiresAt}`));
    if (!due.length) return;
    due.forEach((hold) => expired.current.add(`${hold.id}:${hold.expiresAt}`));
    setState((s) => ({ ...s, notice: 'A seat hold has expired or its event has started. Availability is being refreshed.' }));
    notifyAvailability();
    void refresh();
  }, [visible.holds, now, refresh]);

  const run = async (action: Action, hold?: TimedHold, selection?: { seat: Seat; event: EventDetail }): Promise<boolean> => {
    if (!attendee || !token || mutation.current || !session.current || localStorage.getItem('token') !== token) return false;
    const ready = visible.loaded && !visible.syncing && !visible.syncError;
    if (action === 'hold' && !ready || action === 'confirm' && !hold?.uncertain && !ready) return false;
    mutation.current = true; // Synchronous guard also blocks clicks before React renders.
    const generation = epoch.current;
    const signal = session.current.signal;
    const current = () => !signal.aborted && generation === epoch.current && localStorage.getItem('token') === token;
    ++sequence.current;
    read.current?.abort();
    setState((s) => ({ ...s, pending: `${action}:${hold?.id ?? selection!.seat.id}`, syncing: false, actionError: '', notice: '' }));
    let refreshAfter = true;
    const startedAt = performance.now();
    try {
      const path = action === 'hold' ? '/holds' : `/holds/${hold!.id}/${action}`;
      const data = await api<HoldResponse | ConfirmHoldResponse>(path, {
        method: 'POST', signal, ...(selection ? { body: JSON.stringify({ seatId: selection.seat.id }) } : {}),
      }, true);
      if (!current()) return false;
      const clock = serverClock(data.serverTime, startedAt);
      setState((s) => {
        const holds = s.holds.filter((old) => old.id !== data.hold.id);
        if (action === 'hold') holds.push({ ...data.hold, clock, seat: {
          id: selection!.seat.id, label: selection!.seat.label, row: selection!.seat.row, col: selection!.seat.col,
          event: { id: selection!.event.id, title: selection!.event.title, venue: selection!.event.venue, startsAt: selection!.event.startsAt },
        } });
        return { ...s, holds, notice: action === 'hold' ? `Seat ${selection!.seat.label} is held for you.` : action === 'confirm' ? `Seat ${hold!.seat.label} is booked.` : `Seat ${hold!.seat.label} was released.`, focusHoldId: action === 'hold' ? data.hold.id : null };
      });
      return true;
    } catch (error) {
      if (!current()) return false;
      const rejected = error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status);
      const terminal = error instanceof ApiError && [404, 409].includes(error.status);
      refreshAfter = !(error instanceof ApiError && error.status === 403);
      setState((s) => ({ ...s,
        holds: error instanceof ApiError && error.status === 403 ? [] : s.holds.filter((old) => !(terminal && old.id === hold?.id)).map((old) => old.id === hold?.id && !rejected ? { ...old, uncertain: action as 'confirm' | 'release' } : old),
        actionError: rejected ? errorMessage(error) : action === 'hold' ? 'The hold request could not be verified. Refresh your holds before trying again.' : `${action === 'confirm' ? 'Confirmation' : 'Release'} could not be verified. Retry the same request${action === 'confirm' ? ' or check My Bookings' : ''}.`,
        syncError: action === 'hold' && !rejected ? 'Verify your holds before trying again.' : s.syncError,
        uncertainCreation: action === 'hold' && !rejected,
      }));
      return false;
    } finally {
      if (current()) {
        mutation.current = false;
        setState((s) => ({ ...s, pending: null }));
        notifyAvailability();
        if (refreshAfter) void refresh();
      }
    }
  };

  return <HoldContext.Provider value={{ ...visible, now, ready: visible.loaded && !visible.syncing && !visible.syncError && !visible.pending,
    refresh, create: (seat, event) => run('hold', undefined, { seat, event }), confirm: (hold) => run('confirm', hold), release: (hold) => run('release', hold),
  }}>{children}</HoldContext.Provider>;
}

export function useHolds() {
  const value = useContext(HoldContext);
  if (!value) throw new Error('Seat hold controls require HoldProvider');
  return value;
}
