import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { api, ApiError } from '../api';
import { clearSession, saveSession } from '../auth';
import { ActiveHold, EventDetail } from '../types';
import { attendee, testEvent, testHold, testServerTime } from '../test/holdFixtures';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});
const mockedApi = vi.mocked(api);
let elapsed = 0;
let active: ActiveHold[];
let booked: Set<number>;
let released: Set<number>;
let detail: EventDetail;
let intercept: ((path: string, options?: RequestInit) => Promise<unknown> | undefined) | undefined;
const serverTime = () => new Date(Date.parse(testServerTime) + elapsed).toISOString();
const posts = (path: string) => mockedApi.mock.calls.filter(([url, options]) => url === path && options?.method === 'POST');
const card = (seat = 'A1') => screen.queryByRole('article', { name: new RegExp('Your hold for seat ' + seat) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function open(path = '/events/1') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function choose() {
  fireEvent.click(await screen.findByRole('button', { name: 'Seat A1, available' }));
  const button = screen.getByRole('button', { name: 'Hold for 10 minutes' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}
async function readyConfirm() {
  const button = await screen.findByRole('button', { name: 'Confirm seat A1' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

beforeEach(() => {
  elapsed = 0;
  active = [];
  booked = new Set();
  released = new Set();
  detail = structuredClone(testEvent);
  intercept = undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  saveSession({ token: 'session-a', user: attendee });
  mockedApi.mockReset();
  mockedApi.mockImplementation(async (path, options) => {
    const overridden = intercept?.(path, options);
    if (overridden !== undefined) return overridden;
    if (path === '/holds/mine') return { holds: active.filter((hold) => Date.parse(hold.expiresAt) > Date.parse(serverTime()) && Date.parse(hold.seat.event.startsAt) > Date.parse(serverTime())), serverTime: serverTime() };
    if (path.startsWith('/events/')) return { ...detail, serverTime: serverTime(), seats: detail.seats.map((seat) => {
      const hold = active.find((row) => row.seatId === seat.id && Date.parse(row.expiresAt) > Date.parse(serverTime()));
      return booked.has(seat.id) ? { ...seat, status: 'BOOKED', available: false, holdExpiresAt: null }
        : hold ? { ...seat, status: 'HELD', available: false, holdExpiresAt: hold.expiresAt } : seat;
    }) };
    if (path === '/events') return [{ ...detail, seatsLeft: booked.size || active.length ? 0 : 1, totalSeats: detail.seats.length, serverTime: serverTime() }];
    if (path === '/bookings/mine') return [];
    if (path === '/holds') {
      const hold = testHold();
      active.push(hold);
      return { hold, serverTime: serverTime() };
    }
    const match = /^\/holds\/(\d+)\/(confirm|release)$/.exec(path);
    if (match) {
      const id = Number(match[1]);
      const hold = testHold(id);
      active = active.filter((row) => row.id !== id);
      if (match[2] === 'confirm') booked.add(hold.seatId);
      else released.add(id);
      return { hold: { ...hold, status: match[2] === 'confirm' ? 'CONFIRMED' : 'RELEASED' }, booking: { id, status: 'CONFIRMED' }, serverTime: serverTime() };
    }
    throw new Error('Unexpected request ' + path);
  });
});
afterEach(() => { vi.useRealTimers(); });

it('recovers the original server deadline despite a wrong browser clock', async () => {
  active = [testHold()];
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-05-01'));
  open();
  expect((await screen.findByRole('timer', { name: 'Time left for seat A1' })).textContent).toBe('10:00');
  await screen.findByRole('button', { name: 'Seat A1, held by you' });
  expect(posts('/holds')).toHaveLength(0);
});

it('creates one hold under duplicate clicks and waits for the server response', async () => {
  const response = deferred<unknown>();
  intercept = (path) => path === '/holds' ? response.promise : undefined;
  open();
  const button = await choose();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(posts('/holds')).toHaveLength(1);
  expect(JSON.parse(posts('/holds')[0][1]!.body as string)).toEqual({ seatId: 10 });
  expect(card()).toBeNull();
  expect(screen.queryByText('Seat A1 is held for you.')).toBeNull();
  active = [testHold()];
  await act(async () => response.resolve({ hold: active[0], serverTime: serverTime() }));
  await screen.findByRole('timer');
  expect(screen.getByText('Seat A1 is held for you.')).toBeTruthy();
  expect(document.activeElement).toBe(card());
  expect(posts('/bookings')).toHaveLength(0);
});

it('confirms a hold and refreshes the booked seat without using immediate booking', async () => {
  active = [testHold()];
  open();
  fireEvent.click(await readyConfirm());
  await screen.findByText('Seat A1 is booked.');
  expect(posts('/holds/41/confirm')).toHaveLength(1);
  await screen.findByRole('button', { name: 'Seat A1, booked' });
  expect(card()).toBeNull();
  expect(booked.size).toBe(1);
  expect(posts('/bookings')).toHaveLength(0);
});

it('releases a hold only after acknowledgement and refreshes availability', async () => {
  active = [testHold()];
  const response = deferred<unknown>();
  intercept = (path) => path === '/holds/41/release' ? response.promise : undefined;
  open();
  const button = await screen.findByRole('button', { name: 'Release seat A1' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(card()).toBeTruthy();
  expect(posts('/holds/41/release')).toHaveLength(1);
  expect(screen.queryByText('Seat A1 was released.')).toBeNull();
  active = [];
  await act(async () => response.resolve({ hold: { ...testHold(), status: 'RELEASED' }, serverTime: serverTime() }));
  await screen.findByText('Seat A1 was released.');
  await screen.findByRole('button', { name: 'Seat A1, available' });
  expect(card()).toBeNull();
});

it('counts down to zero, disables confirmation and automatically recovers availability', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  active = [testHold(41, 2000)];
  open();
  await settle();
  expect(screen.getByRole('timer').textContent).toBe('0:02');
  elapsed = 1000;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole('timer').textContent).toBe('0:01');
  elapsed = 2000;
  await act(async () => { vi.advanceTimersByTime(1000); });
  await settle();
  expect(screen.queryByRole('button', { name: 'Confirm seat A1' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Seat A1, available' })).toBeTruthy();
  expect(screen.getByText(/A seat hold has expired/)).toBeTruthy();
  expect(posts('/holds/41/confirm')).toHaveLength(0);
  expect(posts('/holds')).toHaveLength(0);
});

it('keeps an expired card non-confirmable if expiry synchronization fails', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  active = [testHold(41, 1000)];
  open();
  await settle();
  intercept = (path) => path === '/holds/mine' ? Promise.reject(new Error('Offline')) : undefined;
  elapsed = 1000;
  await act(async () => { vi.advanceTimersByTime(1000); });
  await settle();
  expect(screen.getByText('Hold expired')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Confirm seat A1' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('Offline');
});

it('re-synchronizes on focus without extending the original deadline', async () => {
  active = [testHold(41, 300_000)];
  open();
  expect((await screen.findByRole('timer')).textContent).toBe('5:00');
  elapsed = 60_000;
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('timer').textContent).toBe('4:00'));
  expect(active[0].expiresAt).toBe(testHold(41, 300_000).expiresAt);
  expect(posts('/holds')).toHaveLength(0);
});

it.each(['online', 'pageshow', 'visibilitychange'])('recovers authoritative time after %s', async (event) => {
  active = [testHold()];
  open();
  await screen.findByRole('timer');
  elapsed = 120_000;
  fireEvent(event === 'visibilitychange' ? document : window, new Event(event));
  await waitFor(() => expect(screen.getByRole('timer').textContent).toBe('8:00'));
});

it('blocks acquisition while recovery is pending, then enables the selected available seat', async () => {
  const response = deferred<unknown>();
  intercept = (path) => path === '/holds/mine' ? response.promise : undefined;
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Seat A1, available' }));
  expect(screen.getByText('Recovering your seat holds…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Checking your holds…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => response.resolve({ holds: [], serverTime: serverTime() }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Hold for 10 minutes' }) as HTMLButtonElement).disabled).toBe(false));
  expect(posts('/holds')).toHaveLength(0);
});

it('offers recovery retry without reporting a network failure as an empty success', async () => {
  active = [testHold()];
  let failed = false;
  intercept = (path) => {
    if (path === '/holds/mine' && !failed) { failed = true; return Promise.reject(new Error('Cannot recover holds')); }
    return undefined;
  };
  open();
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot recover holds');
  expect(card()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh holds' }));
  await screen.findByRole('timer');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('handles an acquisition conflict and refreshes the losing seat', async () => {
  intercept = (path) => {
    if (path === '/holds') { booked.add(10); return Promise.reject(new ApiError(409, 'Seat is already held or booked', 'SEAT_UNAVAILABLE')); }
    return undefined;
  };
  open();
  fireEvent.click(await choose());
  expect((await screen.findByRole('alert')).textContent).toContain('already held or booked');
  await screen.findByRole('button', { name: 'Seat A1, booked' });
  expect(card()).toBeNull();
  expect(screen.queryByText('Seat A1 is held for you.')).toBeNull();
});

it.each(['confirm', 'release'] as const)('handles rejected %s without claiming success', async (action) => {
  active = [testHold()];
  intercept = (path) => {
    if (path === '/holds/41/' + action) {
      active = [];
      return Promise.reject(new ApiError(409, action === 'confirm' ? 'This hold has expired' : 'This hold is no longer active', action === 'confirm' ? 'HOLD_EXPIRED' : 'HOLD_NOT_ACTIVE'));
    }
    return undefined;
  };
  open();
  await readyConfirm();
  fireEvent.click(screen.getByRole('button', { name: (action === 'confirm' ? 'Confirm' : 'Release') + ' seat A1' }));
  expect((await screen.findByRole('alert')).textContent).toContain(action === 'confirm' ? 'expired' : 'no longer active');
  expect(card()).toBeNull();
  expect(screen.queryByText(action === 'confirm' ? 'Seat A1 is booked.' : 'Seat A1 was released.')).toBeNull();
});

it('clears hold controls on an authorization rejection', async () => {
  active = [testHold()];
  intercept = (path) => path === '/holds/41/confirm' ? Promise.reject(new ApiError(403, 'Attendee access denied', 'FORBIDDEN')) : undefined;
  open();
  fireEvent.click(await readyConfirm());
  expect((await screen.findByRole('alert')).textContent).toContain('Attendee access denied');
  expect(card()).toBeNull();
  expect(screen.queryByText('Seat A1 is booked.')).toBeNull();
});

it('removes private holds and offers sign-in when the current session expires', async () => {
  active = [testHold()];
  intercept = (path) => {
    if (path === '/holds/41/confirm') { clearSession(); return Promise.reject(new ApiError(401, 'Please sign in again')); }
    return undefined;
  };
  open();
  fireEvent.click(await readyConfirm());
  await screen.findByRole('link', { name: /Get Started/ });
  expect(card()).toBeNull();
  expect(screen.queryByText('Seat A1 is booked.')).toBeNull();
});

it('discards an older recovery response after a release succeeds', async () => {
  active = [testHold()];
  open();
  await readyConfirm();
  const old = deferred<unknown>();
  let blocked = false;
  intercept = (path) => {
    if (path === '/holds/mine' && !blocked) { blocked = true; return old.promise; }
    return undefined;
  };
  fireEvent(window, new Event('focus'));
  fireEvent.click(screen.getByRole('button', { name: 'Release seat A1' }));
  await screen.findByText('Seat A1 was released.');
  await act(async () => old.resolve({ holds: [testHold()], serverTime: serverTime() }));
  expect(card()).toBeNull();
});

it('does not leak session A recovery into session B', async () => {
  const old = deferred<unknown>();
  let first = true;
  intercept = (path) => {
    if (path === '/holds/mine' && first) { first = false; return old.promise; }
    return undefined;
  };
  open();
  await screen.findByRole('button', { name: 'Seat A1, available' });
  await act(async () => saveSession({ token: 'session-b', user: { ...attendee, id: 3, name: 'Bob' } }));
  await settle();
  await act(async () => old.resolve({ holds: [testHold()], serverTime: serverTime() }));
  expect(card()).toBeNull();
  expect(localStorage.getItem('token')).toBe('session-b');
});

it('ignores a session A mutation response after session B signs in', async () => {
  active = [testHold()];
  const old = deferred<unknown>();
  intercept = (path) => path === '/holds/41/confirm' ? old.promise : undefined;
  open();
  fireEvent.click(await readyConfirm());
  active = [];
  await act(async () => saveSession({ token: 'session-b', user: { ...attendee, id: 3, name: 'Bob' } }));
  await settle();
  await act(async () => old.resolve({ hold: { ...testHold(), status: 'CONFIRMED' }, booking: { id: 41, status: 'CONFIRMED' }, serverTime: serverTime() }));
  expect(card()).toBeNull();
  expect(screen.queryByText('Seat A1 is booked.')).toBeNull();
});

it.each(['confirm', 'release'] as const)('retains a safe same-ID retry after a lost %s response', async (action) => {
  active = [testHold()];
  let lost = false;
  intercept = (path) => {
    if (path === '/holds/41/' + action && !lost) {
      lost = true;
      active = [];
      if (action === 'confirm') booked.add(10);
      else released.add(41);
      return Promise.reject(new Error('Network response lost'));
    }
    return undefined;
  };
  open();
  await readyConfirm();
  fireEvent.click(screen.getByRole('button', { name: (action === 'confirm' ? 'Confirm' : 'Release') + ' seat A1' }));
  const retry = await screen.findByRole('button', { name: (action === 'confirm' ? 'Retry confirmation for' : 'Retry release for') + ' seat A1' });
  expect(screen.queryByText(action === 'confirm' ? 'Seat A1 is booked.' : 'Seat A1 was released.')).toBeNull();
  expect(card()).toBeTruthy();
  fireEvent.click(retry);
  await screen.findByText(action === 'confirm' ? 'Seat A1 is booked.' : 'Seat A1 was released.');
  expect(posts('/holds/41/' + action)).toHaveLength(2);
  expect(card()).toBeNull();
  expect(action === 'confirm' ? booked.size : released.size).toBe(1);
});

it('recovers a hold after a lost creation response without silently creating another one', async () => {
  intercept = (path) => {
    if (path === '/holds') { active = [testHold()]; return Promise.reject(new Error('Response lost')); }
    return undefined;
  };
  open();
  fireEvent.click(await choose());
  await screen.findByRole('timer');
  await screen.findByText('Your seat hold status was refreshed.');
  expect(posts('/holds')).toHaveLength(1);
  expect(screen.queryByText('Seat A1 is held for you.')).toBeNull();
});

it('recovers from a fresh provider after reopening without a local hold cache', async () => {
  active = [testHold()];
  const first = open();
  await screen.findByRole('timer');
  first.unmount();
  elapsed = 120_000;
  open();
  expect((await screen.findByRole('timer')).textContent).toBe('8:00');
  expect(mockedApi.mock.calls.filter(([path]) => path === '/holds/mine')).toHaveLength(2);
  expect(Object.keys(localStorage).sort()).toEqual(['token', 'user']);
  expect(posts('/holds')).toHaveLength(0);
});

it('keeps hold controls across navigation and refreshes event-list availability', async () => {
  active = [testHold()];
  open();
  await readyConfirm();
  fireEvent.click(screen.getByRole('link', { name: /🎉 Events/ }));
  await screen.findByPlaceholderText('🔍 Search events...');
  expect(card()).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Release seat A1' }));
  await screen.findByText('Seat A1 was released.');
  await waitFor(() => expect(screen.getByText('Seats Available').parentElement!.textContent).toContain('1'));
  expect(mockedApi.mock.calls.filter(([path]) => path === '/holds/mine').length).toBeGreaterThanOrEqual(1);
});

it('shows all seat states without rendering another attendee’s identity', async () => {
  detail = { ...testEvent, seats: testEvent.seats.map((seat) => ({ ...seat, ownerName: 'Private attendee name', ownerEmail: 'private@example.com' })) };
  open();
  await screen.findByRole('button', { name: 'Seat A1, available' });
  expect((screen.getByRole('button', { name: 'Seat A2, held' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Seat A3, booked' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Private attendee name')).toBeNull();
  expect(document.body.textContent).not.toContain('private@example.com');
  expect(within(screen.getByRole('list', { name: 'Seat status legend' })).getByText('Closed')).toBeTruthy();
});

it('refreshes an already mounted booking history after confirming from the global panel', async () => {
  active = [testHold()];
  intercept = (path) => path === '/bookings/mine' ? Promise.resolve(booked.has(10) ? [{
    id: 41, seat: 'A1', status: 'CONFIRMED', createdAt: testServerTime,
    event: { id: detail.id, title: detail.title, venue: detail.venue, startsAt: detail.startsAt, price: detail.price, priceCents: detail.priceCents },
  }] : []) : undefined;
  open('/my-bookings');
  await screen.findByText('No bookings yet!');
  fireEvent.click(await readyConfirm());
  await screen.findByText('Seat A1 is booked.');
  await screen.findByText('CONFIRMED');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  expect(screen.queryByText('No bookings yet!')).toBeNull();
});

it('recovers holds across events and releases only the selected reservation', async () => {
  const otherEvent = { ...testEvent, id: 2, title: 'Second workshop' };
  const otherHold = testHold(42, 240_000, otherEvent);
  otherHold.seatId = 20;
  otherHold.seat = { ...otherHold.seat, id: 20, label: 'B1' };
  active = [testHold(), otherHold];
  open();
  await readyConfirm();
  expect(screen.getAllByRole('timer')).toHaveLength(2);
  expect(screen.getByRole('timer', { name: 'Time left for seat B1' }).textContent).toBe('4:00');
  fireEvent.click(screen.getByRole('button', { name: 'Release seat A1' }));
  await screen.findByText('Seat A1 was released.');
  expect(card()).toBeNull();
  expect(card('B1')).toBeTruthy();
  expect(posts('/holds/42/release')).toHaveLength(0);
  expect((screen.getByRole('link', { name: 'Second workshop' }) as HTMLAnchorElement).getAttribute('href')).toBe('/events/2');
});

it('closes all seat controls using server time when an event has started', async () => {
  detail = { ...testEvent, startsAt: '2026-10-23T11:00:00Z', seats: testEvent.seats.map((seat) => ({ ...seat, available: false, status: 'CLOSED', holdExpiresAt: null })) };
  open();
  await screen.findByRole('button', { name: 'Seat A1, closed' });
  expect((screen.getByRole('button', { name: 'Event closed' }) as HTMLButtonElement).disabled).toBe(true);
  expect(posts('/holds')).toHaveLength(0);
});

it('requires sign-in before holding a selected seat', async () => {
  clearSession();
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Seat A1, available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to hold' }));
  await screen.findByLabelText('Email address');
  expect(posts('/holds')).toHaveLength(0);
  expect(mockedApi.mock.calls.some(([path]) => path === '/holds/mine')).toBe(false);
});

it('preserves organizer navigation and prevents attendee-only hold actions', async () => {
  saveSession({ token: 'organizer-session', user: { ...attendee, role: 'ORGANIZER' } });
  open();
  await screen.findByRole('button', { name: 'Seat A1, available' });
  expect(screen.getByRole('link', { name: /Create Event/ })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Hold for 10 minutes' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mockedApi.mock.calls.some(([path]) => path === '/holds/mine')).toBe(false);
});
