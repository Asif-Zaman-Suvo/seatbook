import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MyBookingsPage from './MyBookingsPage';
import { api } from '../api';
import { clearSession, saveSession } from '../auth';
import { Booking } from '../types';
import { attendee, testServerTime } from '../test/holdFixtures';

vi.mock('../api', async () => ({ ...await vi.importActual<typeof import('../api')>('../api'), api: vi.fn() }));
const mockedApi = vi.mocked(api);
const bob = { ...attendee, id: 2, name: 'Bob', email: 'bob@example.com' };
const booking = (id: number, title: string): Booking => ({
  id, status: 'CONFIRMED', seat: 'A1', createdAt: testServerTime,
  event: { id, title, venue: 'Dhaka', startsAt: '2099-01-01T00:00:00Z', price: '$15.00', priceCents: 1500 },
});
const aliceBooking = booking(41, 'Private Alice booking');
const bobBooking = booking(42, 'Private Bob booking');
let readA: () => Promise<Booking[]>;
let readB: () => Promise<Booking[]>;
let cancelA: () => Promise<{ success: boolean }>;
let cancelB: () => Promise<{ success: boolean }>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function open() { return render(<MemoryRouter><MyBookingsPage /></MemoryRouter>); }
async function switchToBob(storageEvent = false) {
  await act(async () => {
    if (storageEvent) {
      localStorage.setItem('token', 'session-b');
      localStorage.setItem('user', JSON.stringify(bob));
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', oldValue: 'session-a', newValue: 'session-b' }));
    } else saveSession({ token: 'session-b', user: bob });
  });
}
const reads = () => mockedApi.mock.calls.filter(([path]) => path === '/bookings/mine');
const cancels = () => mockedApi.mock.calls.filter(([path]) => path.endsWith('/cancel'));
async function finish(request: ReturnType<typeof deferred<Booking[]>>, outcome: 'success' | 'failure') {
  await act(async () => outcome === 'success' ? request.resolve([aliceBooking]) : request.reject(new Error('Old Alice read failed')));
}

beforeEach(() => {
  saveSession({ token: 'session-a', user: attendee });
  readA = async () => [aliceBooking];
  readB = async () => [bobBooking];
  cancelA = cancelB = async () => ({ success: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mockedApi.mockReset();
  mockedApi.mockImplementation(async (path) => {
    const alice = localStorage.getItem('token') === 'session-a';
    if (path === '/bookings/mine') return alice ? readA() : readB();
    if (path.endsWith('/cancel')) return alice ? cancelA() : cancelB();
    throw new Error('Unexpected request ' + path);
  });
});

it.each([false, true])('replaces populated A history after an account switch (storage event: %s)', async (storageEvent) => {
  open();
  await screen.findByText(aliceBooking.event.title);
  await switchToBob(storageEvent);
  expect(screen.queryByText(aliceBooking.event.title)).toBeNull();
  await screen.findByText(bobBooking.event.title);
  expect(reads()).toHaveLength(2);
  expect(reads()[0][1]!.signal!.aborted).toBe(true);
  expect(screen.getByText('Total Bookings').parentElement!.textContent).toBe('Total Bookings1');
});

it('hides populated A history immediately while B recovery is still pending', async () => {
  const pending = deferred<Booking[]>();
  readB = () => pending.promise;
  open();
  await screen.findByText(aliceBooking.event.title);
  await switchToBob();
  expect(screen.queryByText(aliceBooking.event.title)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(screen.getByText('Loading your bookings... 🎟️')).toBeTruthy();
  await act(async () => pending.resolve([bobBooking]));
  await screen.findByText(bobBooking.event.title);
});

it.each(['success', 'failure'] as const)('ignores a delayed A read %s after B history has loaded', async (outcome) => {
  const old = deferred<Booking[]>();
  readA = () => old.promise;
  open();
  await waitFor(() => expect(reads()).toHaveLength(1));
  await switchToBob();
  await screen.findByText(bobBooking.event.title);
  await finish(old, outcome);
  expect(screen.queryByText(aliceBooking.event.title)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(bobBooking.event.title)).toBeTruthy();
});

it.each(['success', 'failure'] as const)('does not let A read %s clear B loading state', async (outcome) => {
  const old = deferred<Booking[]>(), current = deferred<Booking[]>();
  readA = () => old.promise;
  readB = () => current.promise;
  open();
  await waitFor(() => expect(reads()).toHaveLength(1));
  await switchToBob();
  await finish(old, outcome);
  expect(screen.getByText('Loading your bookings... 🎟️')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => current.resolve([bobBooking]));
  await screen.findByText(bobBooking.event.title);
});

it('preserves B error feedback when an older A request fails later', async () => {
  const old = deferred<Booking[]>();
  readA = () => old.promise;
  readB = async () => { throw new Error('Bob history is unavailable'); };
  open();
  await switchToBob();
  await screen.findByRole('alert');
  await finish(old, 'failure');
  expect(screen.getByRole('alert').textContent).toContain('Bob history is unavailable');
  expect(screen.getByRole('alert').textContent).not.toContain('Alice');
});

it.each(['success', 'failure'] as const)('ignores delayed A cancellation %s while B cancellation is pending', async (outcome) => {
  const old = deferred<{ success: boolean }>(), current = deferred<{ success: boolean }>();
  cancelA = () => old.promise;
  cancelB = () => current.promise;
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  const oldSignal = cancels()[0][1]!.signal!;
  await switchToBob();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => outcome === 'success' ? old.resolve({ success: true }) : old.reject(new Error('Old Alice cancellation failed')));
  expect(screen.getByText(bobBooking.event.title)).toBeTruthy();
  expect(screen.queryByText('Booking cancelled successfully.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(reads()).toHaveLength(2);
  readB = async () => [{ ...bobBooking, status: 'CANCELLED' }];
  await act(async () => current.resolve({ success: true }));
  await screen.findByText('CANCELLED');
  expect(screen.getByText('Booking cancelled successfully.')).toBeTruthy();
});

it.each(['success', 'failure'] as const)('clears visible A cancellation %s feedback on switching accounts', async (outcome) => {
  cancelA = async () => {
    if (outcome === 'failure') throw new Error('Private Alice cancellation error');
    readA = async () => [{ ...aliceBooking, status: 'CANCELLED' }];
    return { success: true };
  };
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await screen.findByText(outcome === 'success' ? 'Booking cancelled successfully.' : /Private Alice cancellation error/);
  await switchToBob();
  await screen.findByText(bobBooking.event.title);
  expect(screen.queryByText('Booking cancelled successfully.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(aliceBooking.event.title)).toBeNull();
});

it('aborts pending cancellation and removes private content on logout', async () => {
  const old = deferred<{ success: boolean }>();
  cancelA = () => old.promise;
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await act(async () => clearSession());
  expect(cancels()[0][1]!.signal!.aborted).toBe(true);
  await act(async () => old.resolve({ success: true }));
  expect(screen.queryByText(aliceBooking.event.title)).toBeNull();
  expect(screen.queryByText('Booking cancelled successfully.')).toBeNull();
});

it('does not submit an A cancellation if the session changes inside the confirmation dialog', async () => {
  vi.mocked(window.confirm).mockImplementation(() => {
    saveSession({ token: 'session-b', user: bob });
    return true;
  });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await screen.findByText(bobBooking.event.title);
  expect(cancels()).toHaveLength(0);
});

it('sends one cancellation under duplicate clicks before rerender', async () => {
  const request = deferred<{ success: boolean }>();
  cancelA = () => request.promise;
  open();
  const button = await screen.findByRole('button', { name: 'Cancel' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(cancels()).toHaveLength(1);
  await act(async () => request.reject(new Error('Please retry cancellation')));
  await screen.findByRole('alert');
});
