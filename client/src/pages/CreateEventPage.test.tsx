import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import CreateEventPage from './CreateEventPage';
import App from '../App';
import { api, ApiError } from '../api';
import { saveSession } from '../auth';
import { attendee } from '../test/holdFixtures';

vi.mock('../api', async () => ({ ...await vi.importActual<typeof import('../api')>('../api'), api: vi.fn() }));
const mockedApi = vi.mocked(api);
function Created() { return <p>Created event {useParams().id}</p>; }
function open() {
  render(<MemoryRouter initialEntries={['/events/new']}><Routes>
    <Route path="/events/new" element={<CreateEventPage />} />
    <Route path="/events/:id" element={<Created />} />
  </Routes></MemoryRouter>);
}
function fill(price = '19.95') {
  fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Organizer workshop' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A workshop in Dhaka' } });
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Banani Hall' } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2099-01-02T18:30' } });
  fireEvent.change(screen.getByLabelText('Seat rows'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Seat columns'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Ticket price'), { target: { value: price } });
}
beforeEach(() => {
  mockedApi.mockReset();
  saveSession({ token: 'organizer-session', user: { ...attendee, role: 'ORGANIZER' } });
});

it('submits the organizer grid, timezone and integer ticket cents before navigating', async () => {
  mockedApi.mockResolvedValue({ id: 42 });
  open();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Launch Event 🚀' }));
  await screen.findByText('Created event 42');
  expect(mockedApi).toHaveBeenCalledOnce();
  const [path, options, authenticated] = mockedApi.mock.calls[0];
  expect([path, options!.method, authenticated]).toEqual(['/events', 'POST', true]);
  expect(JSON.parse(options!.body as string)).toEqual({
    title: 'Organizer workshop', description: 'A workshop in Dhaka', venue: 'Banani Hall',
    startsAt: new Date('2099-01-02T18:30').toISOString(), rows: 2, cols: 3, priceCents: 1995,
  });
});

it('retains form values and permits retry after a rejected organizer submission', async () => {
  mockedApi.mockRejectedValueOnce(new ApiError(400, 'Start time must be in the future')).mockResolvedValueOnce({ id: 43 });
  open();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Launch Event 🚀' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Start time must be in the future');
  expect((screen.getByLabelText('Event title') as HTMLInputElement).value).toBe('Organizer workshop');
  expect(screen.queryByText(/Created event/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Launch Event 🚀' }));
  await screen.findByText('Created event 43');
});

it('disables duplicate clicks and waits for the creation acknowledgement', async () => {
  let resolve!: (value: { id: number }) => void;
  mockedApi.mockReturnValue(new Promise((done) => { resolve = done; }));
  open();
  fill();
  const button = screen.getByRole('button', { name: 'Launch Event 🚀' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mockedApi).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/Created event/)).toBeNull();
  await act(async () => resolve({ id: 44 }));
  await screen.findByText('Created event 44');
});

it('preserves support for free events', async () => {
  mockedApi.mockResolvedValue({ id: 45 });
  open();
  fill('0');
  fireEvent.click(screen.getByRole('button', { name: 'Launch Event 🚀' }));
  await screen.findByText('Created event 45');
  expect(JSON.parse(mockedApi.mock.calls[0][1]!.body as string).priceCents).toBe(0);
});

it('rejects fractional cents without sending or silently rounding a request', async () => {
  open();
  fill('1.001');
  // Bypass native step validation to verify the submit-handler guard as well.
  fireEvent.submit(screen.getByRole('button', { name: 'Launch Event 🚀' }).closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain('at most two decimal places');
  expect(mockedApi).not.toHaveBeenCalled();
});

it('redirects attendees away from organizer creation without submitting anything', async () => {
  saveSession({ token: 'attendee-session', user: attendee });
  mockedApi.mockImplementation(async (path) => {
    if (path === '/holds/mine') return { holds: [], serverTime: '2026-10-23T00:00:00Z' };
    if (path === '/events') return [];
    throw new Error('Unexpected request ' + path);
  });
  render(<MemoryRouter initialEntries={['/events/new']}><App /></MemoryRouter>);
  await screen.findByPlaceholderText('🔍 Search events...');
  await waitFor(() => expect(screen.queryByLabelText('Event title')).toBeNull());
  expect(mockedApi.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
