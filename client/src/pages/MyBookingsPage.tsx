import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, errorMessage } from '../api';
import { Booking } from '../types';
import { availabilityChanged } from '../holds';
import { useUser } from '../auth';

export default function MyBookingsPage() {
  const user = useUser();
  const token = user?.role === 'ATTENDEE' ? localStorage.getItem('token') : null;
  // Remount all private state in the same render as an identity change. Effect
  // cleanup alone would leave the previous account visible for another render.
  return token ? <BookingHistory key={token} token={token} /> : null;
}

function BookingHistory({ token }: { token: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const cancellation = useRef<AbortController | null>(null);
  const confirmed = bookings.filter((booking) => booking.status === 'CONFIRMED');
  const totalSpent = confirmed.reduce((total, booking) => total + booking.event.priceCents, 0) / 100;
  const upcoming = confirmed.filter((booking) => new Date(booking.event.startsAt) > new Date()).length;

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener(availabilityChanged, refresh);
    return () => window.removeEventListener(availabilityChanged, refresh);
  }, []);

  useEffect(() => () => cancellation.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && localStorage.getItem('token') === token;
    setLoading(true);
    setError('');
    api<Booking[]>('/bookings/mine', { signal: controller.signal }, true)
      .then((data) => { if (current()) setBookings(data); })
      .catch((error) => { if (current()) setError(errorMessage(error)); })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [reload, token]);

  const cancelBooking = async (id: number) => {
    if (cancellation.current || localStorage.getItem('token') !== token || !window.confirm('Cancel this booking?')) return;
    // Another tab can switch accounts while the native dialog is open.
    if (localStorage.getItem('token') !== token) return;
    const controller = new AbortController();
    cancellation.current = controller;
    const current = () => !controller.signal.aborted && localStorage.getItem('token') === token;
    setCancelling(id);
    setToast('');
    setError('');
    try {
      await api<{ success: boolean }>(`/bookings/${id}/cancel`, { method: 'POST', signal: controller.signal }, true);
      if (!current()) return;
      setToast('Booking cancelled successfully.');
      setReload((value) => value + 1);
    } catch (error) { if (current()) setError(errorMessage(error)); }
    finally {
      if (current()) setCancelling(null);
      if (cancellation.current === controller) cancellation.current = null;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="w-16 h-16 border-4 border-[#f97316] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-6 text-white/60 animate-pulse">Loading your bookings... 🎟️</p>
      </div>
    );
  }

  return (
    <div>
      {error && <p role="alert" className="mb-4 text-red-300">{error} <button className="underline" onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
      {toast && (
        <div role="status" className="fixed top-24 left-6 right-6 sm:left-auto z-50 px-6 py-4 rounded-2xl shadow-2xl font-medium bg-gradient-to-r from-[#22c55e] to-[#16a34a]">
          {toast}
        </div>
      )}

      <h1 className="text-5xl font-extrabold mb-2">
        My <span className="gradient-text">Bookings</span> 🎟️
      </h1>
      <p className="text-white/50 mb-10">All your amazing experiences in one place ✨</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Total Bookings</div>
          <div className="text-4xl font-bold gradient-text">{bookings.length}</div>
        </div>
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Upcoming</div>
          <div className="text-4xl font-bold gradient-text">{upcoming}</div>
        </div>
        <div className="glass rounded-2xl p-6">
          <div className="text-white/50 text-sm">Confirmed ticket value</div>
          <div className="text-4xl font-bold gradient-text break-words">${totalSpent.toFixed(2)}</div>
        </div>
      </div>

      {!error && bookings.length === 0 && (
        <div className="text-center py-20 text-white/40">
          <div className="text-6xl">🎭</div>
          <p className="mt-4">No bookings yet!</p>
          <Link to="/" className="text-[#a855f7]">
            Explore events →
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {bookings.map((b) => (
          <div key={b.id} className="glass rounded-2xl p-6 flex flex-wrap gap-5 items-center justify-between">
            <div className="flex min-w-0 items-center gap-5">
              <div className="w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br from-[#a855f7] via-[#ec4899] to-[#f97316] flex items-center justify-center text-2xl">
                🎭
              </div>
              <div className="min-w-0">
                <div className="font-bold text-lg break-words">{b.event.title}</div>
                <div className="text-white/50 text-sm break-words">
                  📍 {b.event.venue} · 📅 {b.event.startsAt.split('T')[0]}
                </div>
              </div>
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-3 sm:gap-6">
              <span className="px-3 py-1 rounded-full bg-[#a855f7]/20 text-[#d8b4fe] text-sm">💺 {b.seat}</span>
              <span className="font-bold whitespace-nowrap shrink-0">{b.event.price}</span>
              <span className={`px-3 py-1 rounded-full text-sm ${b.status === 'CONFIRMED' ? 'bg-green-500/20 text-green-200' : 'bg-white/10 text-white/60'}`}>{b.status}</span>
              {b.status === 'CONFIRMED' && <button
                onClick={() => cancelBooking(b.id)}
                disabled={cancelling !== null}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#ef4444] to-[#dc2626] text-sm font-semibold disabled:opacity-50"
              >
                {cancelling === b.id ? 'Cancelling…' : 'Cancel'}
              </button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
