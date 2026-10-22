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
  render(<MemoryRouter><EventDetailPage /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('Event not found');
  expect(screen.queryByText('Loading event... 🎭')).toBeNull();
});

it('books an available seat, disables occupied seats, and refreshes availability', async () => {
  const event = {
    id: 1, title: 'Test event', description: '', venue: 'Dhaka', startsAt: '2099-01-01T00:00:00Z',
    priceCents: 1500, price: '$15.00', rows: 1, cols: 2, organizer: { id: 2, name: 'Organizer' },
    seats: [{ id: 10, row: 0, col: 0, label: 'A1', available: true }, { id: 11, row: 0, col: 1, label: 'A2', available: false }],
  };
  saveSession({ token: 'test-token', user: { id: 1, email: 'alice@example.com', name: 'Alice', role: 'ATTENDEE' } });
  mockedApi.mockResolvedValueOnce(event).mockResolvedValueOnce({ id: 20 })
    .mockResolvedValueOnce({ ...event, seats: event.seats.map((seat) => ({ ...seat, available: false })) });
  render(<MemoryRouter initialEntries={['/events/1']}><Routes><Route path="/events/:id" element={<EventDetailPage />} /></Routes></MemoryRouter>);
  const available = await screen.findByRole('button', { name: 'Seat A1' });
  expect((screen.getByRole('button', { name: 'Seat A2, unavailable' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(available);
  fireEvent.click(screen.getByRole('button', { name: /Book Now/ }));
  await screen.findByText('Seat A1 is booked.');
  expect(mockedApi.mock.calls[1][0]).toBe('/bookings');
  expect(JSON.parse(mockedApi.mock.calls[1][1]!.body as string)).toEqual({ seatId: 10 });
  await screen.findByRole('button', { name: 'Seat A1, unavailable' });
  expect(screen.queryByText(/Service fee/)).toBeNull();
});

it('redirects an unauthenticated booking-history visit to login', () => {
  render(<MemoryRouter initialEntries={['/my-bookings']}><App /></MemoryRouter>);
  expect(screen.getByLabelText('Email address')).toBeTruthy();
  expect(mockedApi).not.toHaveBeenCalled();
});
