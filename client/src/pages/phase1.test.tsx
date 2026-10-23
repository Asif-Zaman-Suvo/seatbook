import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LoginPage from './LoginPage';
import MyBookingsPage from './MyBookingsPage';
import EventsPage from './EventsPage';
import EventDetailPage from './EventDetailPage';
import { api } from '../api';
import { saveSession } from '../auth';
import App from '../App';
import { HoldProvider } from '../holds';
import SeatHolds from '../components/SeatHolds';
import { attendee, testEvent, testHold, testServerTime } from '../test/holdFixtures';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: vi.fn() };
});
const mockedApi = vi.mocked(api);
beforeEach(() => { mockedApi.mockReset(); });

it('lets a new organizer register with the selected role', async () => {
  mockedApi.mockResolvedValue({ token: 'test-token', user: { id: 1, email: 'organizer@example.com', name: 'Organizer', role: 'ORGANIZER' } });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Organizer' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'organizer@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password-123' } });
  fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'ORGANIZER' } });
  fireEvent.submit(screen.getByRole('button', { name: /Create Account/ }).closest('form')!);
  await waitFor(() => expect(mockedApi).toHaveBeenCalled());
  const [path, options] = mockedApi.mock.calls[0];
  expect(path).toBe('/auth/register');
  expect(JSON.parse(options!.body as string).role).toBe('ORGANIZER');
});

it('shows a failed cancellation and retains the confirmed booking', async () => {
  saveSession({ token: 'test-token', user: attendee });
  mockedApi.mockResolvedValueOnce([{
    id: 5, status: 'CONFIRMED', seat: 'A1', createdAt: '2026-10-22T00:00:00Z',
    event: { id: 1, title: 'Test event', venue: 'Dhaka', startsAt: '2099-01-01T00:00:00Z', priceCents: 1500, price: '$15.00' },
  }]).mockRejectedValueOnce(new Error('Cancellation failed'));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<MemoryRouter><MyBookingsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Cancellation failed');
  expect(screen.queryByText(/cancelled successfully/)).toBeNull();
  expect(screen.getByText('CONFIRMED')).toBeTruthy();
});

it.each(['a'.repeat(80), '🔒'.repeat(19)])('submits a legacy login password over 72 bytes unchanged (%#)', async (password) => {
  mockedApi.mockResolvedValue({ token: 'test-token', user: { id: 1, email: 'alice@example.com', name: 'Alice', role: 'ATTENDEE' } });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  const input = screen.getByLabelText('Password') as HTMLInputElement;
  expect(input.maxLength).toBe(32768);
  expect(input.minLength).toBe(1);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alice@example.com' } });
  fireEvent.change(input, { target: { value: password } });
  fireEvent.submit(screen.getByRole('button', { name: /Sign In/ }).closest('form')!);
  await waitFor(() => expect(mockedApi).toHaveBeenCalledOnce());
  const [path, options] = mockedApi.mock.calls[0];
  expect(path).toBe('/auth/login');
  expect(JSON.parse(options!.body as string).password).toBe(password);
});

it('retains the registration password limit when switching from login', () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  const input = screen.getByLabelText('Password') as HTMLInputElement;
  expect(input.maxLength).toBe(72);
  expect(input.minLength).toBe(12);
  expect(screen.getByText(/at most 72 UTF-8 bytes/)).toBeTruthy();
});

it('excludes cancelled bookings from upcoming and ticket totals', async () => {
  saveSession({ token: 'test-token', user: attendee });
  mockedApi.mockResolvedValue([{
    id: 5, status: 'CANCELLED', seat: 'A1', createdAt: '2026-10-22T00:00:00Z',
    event: { id: 1, title: 'Cancelled event', venue: 'Dhaka', startsAt: '2099-01-01T00:00:00Z', priceCents: 1500, price: '$15.00' },
  }]);
  render(<MemoryRouter><MyBookingsPage /></MemoryRouter>);
  await screen.findByText('CANCELLED');
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(screen.getByText('$0.00')).toBeTruthy();
  expect(screen.getByText('Upcoming').parentElement!.textContent).toBe('Upcoming0');
});

it('renders an event-list failure with a retry instead of an empty success', async () => {
  mockedApi.mockRejectedValue(new Error('Service unavailable'));
  render(<MemoryRouter><EventsPage /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable');
  expect(screen.queryByText('No events found')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

it('renders an event-detail failure instead of leaving the loading spinner', async () => {
  mockedApi.mockRejectedValue(new Error('Event not found'));
  render(<MemoryRouter><HoldProvider><EventDetailPage /></HoldProvider></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('Event not found');
  expect(screen.queryByText('Loading event... 🎭')).toBeNull();
});

it('holds then confirms an available seat, disables occupied seats, and refreshes availability', async () => {
  let held = false, booked = false;
  const hold = testHold();
  saveSession({ token: 'test-token', user: { id: 1, email: 'alice@example.com', name: 'Alice', role: 'ATTENDEE' } });
  mockedApi.mockImplementation(async (path, options) => {
    if (path === '/holds/mine') return { holds: held ? [hold] : [], serverTime: testServerTime };
    if (path === '/events/1') return { ...testEvent, seats: testEvent.seats.map((seat) => seat.id === 10 && (held || booked) ? { ...seat, available: false, status: booked ? 'BOOKED' : 'HELD', holdExpiresAt: held ? hold.expiresAt : null } : seat) };
    if (path === '/holds' && options?.method === 'POST') { held = true; return { hold, serverTime: testServerTime }; }
    if (path === '/holds/41/confirm') { held = false; booked = true; return { hold: { ...hold, status: 'CONFIRMED' }, booking: { id: 41, status: 'CONFIRMED' }, serverTime: testServerTime }; }
    throw new Error('Unexpected request ' + path);
  });
  render(<MemoryRouter initialEntries={['/events/1']}><HoldProvider><SeatHolds /><Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes></HoldProvider></MemoryRouter>);
  const available = await screen.findByRole('button', { name: 'Seat A1, available' });
  expect((screen.getByRole('button', { name: 'Seat A3, booked' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(available);
  fireEvent.click(screen.getByRole('button', { name: 'Hold for 10 minutes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm seat A1' }));
  await screen.findByText('Seat A1 is booked.');
  const created = mockedApi.mock.calls.find(([path]) => path === '/holds')!;
  expect(JSON.parse(created[1]!.body as string)).toEqual({ seatId: 10 });
  expect(mockedApi.mock.calls.some(([path]) => path === '/bookings')).toBe(false);
  await screen.findByRole('button', { name: 'Seat A1, booked' });
  expect(screen.queryByText(/Service fee/)).toBeNull();
});

it('redirects an unauthenticated booking-history visit to login', () => {
  render(<MemoryRouter initialEntries={['/my-bookings']}><App /></MemoryRouter>);
  expect(screen.getByLabelText('Email address')).toBeTruthy();
  expect(mockedApi).not.toHaveBeenCalled();
});
