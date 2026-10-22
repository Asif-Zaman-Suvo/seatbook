import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api';
import { useUser } from '../auth';
import { EventDetail, Seat } from '../types';

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const user = useUser();
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  const fetchEvent = useCallback(async (signal: AbortSignal) => {
    const data = await api<EventDetail>(`/events/${id}`, { signal });
    if (!signal.aborted) setEvent(data);
  }, [id]);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setEvent(null);
    setSelectedSeat(null);
    setToast(null);
    setPending(false);
    setError('');
    fetchEvent(current.signal)
      .catch((error) => { if (!current.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!current.signal.aborted) setLoading(false); });
    return () => current.abort();
  }, [fetchEvent, reload]);

  const handleBook = async () => {
    if (pending) return;
    if (!selectedSeat) {
      setToast({ type: 'error', message: 'Please select a seat first! 🪑' });
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    const signal = controller.current!.signal;
    setPending(true);
    setError('');
    try {
      await api<{ id: number }>('/bookings', { method: 'POST', body: JSON.stringify({ seatId: selectedSeat.id }), signal }, true);
      if (signal.aborted) return;
      setToast({ type: 'success', message: `Seat ${selectedSeat.label} is booked.` });
      setSelectedSeat(null);
      await fetchEvent(signal).catch(() => { if (!signal.aborted) setError('Booking confirmed. Reload the page to refresh availability.'); });
    } catch (error) {
      if (signal.aborted) return;
      setToast({ type: 'error', message: errorMessage(error) });
      if (error instanceof ApiError && error.status === 409) {
        setSelectedSeat(null);
        await fetchEvent(signal).catch(() => { if (!signal.aborted) setError('Reload the page to refresh availability.'); });
      }
    } finally { if (!signal.aborted) setPending(false); }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <div className="w-16 h-16 border-4 border-[#ec4899] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-6 text-white/60 animate-pulse">Loading event... 🎭</p>
      </div>
    );
  }

  if (!event) return <div role="alert">{error || 'Event not found.'} <button className="underline" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;
  const price = event.priceCents / 100;
  const isPast = new Date(event.startsAt) <= new Date();
  const availableCount = event.seats.filter((seat) => seat.available).length;
  const rows: Seat[][] = [];
  event.seats.forEach((seat) => { (rows[seat.row] ||= []).push(seat); });
  const percentBooked = Math.round(((event.seats.length - availableCount) / event.seats.length) * 100);

  return (
    <div>
      {error && <p role="alert" className="mb-4 text-red-300">{error}</p>}
      {toast && (
        <div
          role="status" aria-live="polite"
          className={`fixed top-24 right-6 z-50 px-6 py-4 rounded-2xl shadow-2xl font-medium ${
            toast.type === 'success'
              ? 'bg-gradient-to-r from-[#22c55e] to-[#16a34a]'
              : 'bg-gradient-to-r from-[#ef4444] to-[#dc2626]'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="rounded-3xl p-10 bg-gradient-to-br from-[#a855f7]/30 via-[#ec4899]/20 to-[#f97316]/20 border border-white/10 glow">
        <span className="px-3 py-1 rounded-full bg-[#a855f7]/30 text-[#d8b4fe] text-xs font-bold">
          {isPast ? '⏰ ENDED' : '✨ LIVE NOW'}
        </span>
        <h1 className="mt-4 text-5xl font-extrabold">{event.title}</h1>
        <p className="mt-4 text-white/60 text-lg">{event.description}</p>
        <div className="mt-6 flex gap-6 text-white/70">
          <span>📍 {event.venue}</span>
          <span>📅 {new Date(event.startsAt).toDateString()}</span>
          <span>👤 {event.organizer.name}</span>
        </div>
      </div>

      <div className="mt-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 min-w-0 glass rounded-3xl p-8">
          <h2 className="text-2xl font-bold mb-2">
            Choose Your <span className="gradient-text">Perfect Seat</span> 🪑
          </h2>
          <p className="text-white/50 mb-6">
            {availableCount} of {event.seats.length} available · {percentBooked}% booked 🔥
          </p>
          <div className="w-full h-2 rounded-full bg-gradient-to-r from-[#a855f7] to-[#ec4899] mb-10 opacity-60"></div>
          <div className="space-y-3 overflow-x-auto">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-3 w-max min-w-full justify-center">
                {row.map((seat) => (
                  <button
                    key={seat.id}
                    type="button" aria-label={`Seat ${seat.label}${seat.available ? '' : ', unavailable'}`} aria-pressed={selectedSeat?.id === seat.id}
                    disabled={!seat.available || isPast || pending}
                    onClick={() => setSelectedSeat(seat)}
                    className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed ${
                      selectedSeat?.id === seat.id
                        ? 'bg-gradient-to-br from-[#ec4899] to-[#f97316] shadow-lg shadow-pink-500/50 scale-110'
                        : seat.available
                        ? 'bg-gradient-to-br from-[#a855f7]/60 to-[#6366f1]/60 hover:from-[#a855f7] hover:to-[#6366f1]'
                        : 'bg-gradient-to-br from-[#a855f7]/20 to-[#6366f1]/20 text-white/30'
                    }`}
                  >
                    {seat.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-3xl p-8 h-fit">
          <h3 className="text-xl font-bold mb-6">Order Summary 🧾</h3>
          <div className="space-y-4 text-white/70">
            <div className="flex justify-between">
              <span>Seat</span>
              <span className="font-bold text-white">{selectedSeat ? selectedSeat.label : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Ticket</span>
              <span>${price.toFixed(2)}</span>
            </div>
            <div className="border-t border-white/10 pt-4 flex justify-between text-xl font-bold text-white">
              <span>Total</span>
              <span className="gradient-text">${price.toFixed(2)}</span>
            </div>
          </div>
          <button
            onClick={handleBook}
            disabled={pending || isPast || !selectedSeat || user?.role === 'ORGANIZER'}
            className="mt-8 w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? 'Booking…' : isPast ? 'Event ended' : 'Book Now 🎟️'}
          </button>
          <p className="mt-4 text-center text-xs text-white/60">{user?.role === 'ORGANIZER' ? 'An attendee account is required to book seats.' : 'Bookings are confirmed immediately.'}</p>
        </div>
      </div>
    </div>
  );
}
