import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useUser } from '../auth';
import { EventDetail, Seat, SeatStatus } from '../types';
import { availabilityChanged, useHolds } from '../holds';
import { remainingMs, ServerClock, serverClock, useMonotonicNow } from '../holdClock';

const seatStyles: Record<SeatStatus, string> = {
  AVAILABLE: 'bg-gradient-to-br from-[#a855f7]/70 to-[#6366f1]/70 hover:from-[#a855f7] hover:to-[#6366f1]',
  HELD: 'bg-amber-400/20 border border-amber-300/50 text-amber-100',
  BOOKED: 'bg-rose-400/15 border border-rose-300/30 text-rose-200',
  CLOSED: 'bg-white/5 border border-white/10 text-white/40',
};

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const holds = useHolds();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [clock, setClock] = useState<ServerClock | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const routeId = useRef(id);
  routeId.current = id;
  const refresh = useRef<() => void>(() => undefined);
  const expirySeen = useRef(new Set<string>());
  const now = useMonotonicNow();

  useEffect(() => {
    let alive = true;
    let revision = 0;
    let active: AbortController | null = null;
    setEvent(null);
    setClock(null);
    setSelectedSeat(null);
    setLoading(true);
    setError('');
    expirySeen.current.clear();
    const load = async () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const request = ++revision;
      setRefreshing(true);
      const startedAt = performance.now();
      const current = () => alive && !controller.signal.aborted && revision === request;
      try {
        const data = await api<EventDetail>('/events/' + id, { signal: controller.signal });
        if (!current()) return;
        const sample = serverClock(data.serverTime, startedAt);
        setEvent(data);
        setClock(sample);
        setError('');
        setSelectedSeat((seat) => seat && data.seats.some((fresh) => fresh.id === seat.id && fresh.available && fresh.status === 'AVAILABLE') ? seat : null);
      } catch (error) {
        if (current()) setError(errorMessage(error));
      } finally {
        if (current()) { setLoading(false); setRefreshing(false); }
      }
    };
    refresh.current = () => { void load(); };
    const sync = () => { if (document.visibilityState !== 'hidden') void load(); };
    void load();
    const timer = window.setInterval(sync, 15_000);
    window.addEventListener(availabilityChanged, sync);
    for (const name of ['focus', 'pageshow', 'online']) window.addEventListener(name, sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      alive = false;
      active?.abort();
      refresh.current = () => undefined;
      window.clearInterval(timer);
      window.removeEventListener(availabilityChanged, sync);
      for (const name of ['focus', 'pageshow', 'online']) window.removeEventListener(name, sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [id, reload]);

  useEffect(() => {
    if (!event || !clock) return;
    const due = event.seats.filter((seat) => seat.status === 'HELD' && seat.holdExpiresAt && remainingMs(seat.holdExpiresAt, clock, now) === 0)
      .map((seat) => 'seat:' + seat.id + ':' + seat.holdExpiresAt);
    if (remainingMs(event.startsAt, clock, now) === 0) due.push('event:' + event.id + ':' + event.startsAt);
    const unseen = due.filter((key) => !expirySeen.current.has(key));
    if (unseen.length) {
      unseen.forEach((key) => expirySeen.current.add(key));
      refresh.current();
    }
  }, [event, clock, now]);

  const handleHold = async () => {
    if (!selectedSeat || !event || holds.pending) return;
    if (!user) { navigate('/login'); return; }
    const eventId = event.id;
    if (await holds.create(selectedSeat, event) && routeId.current === String(eventId)) setSelectedSeat(null);
  };

  if (loading) return <div role="status" className="flex flex-col items-center justify-center py-32">
    <div className="w-16 h-16 border-4 border-[#ec4899] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
    <p className="mt-6 text-white/60">Loading event... 🎭</p>
  </div>;
  if (!event || !clock) return <div role="alert">{error || 'Event not found.'} <button className="underline" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;

  const isPast = remainingMs(event.startsAt, clock, now) === 0;
  const price = event.priceCents / 100;
  const availableCount = isPast ? 0 : event.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.available).length;
  const rows: Seat[][] = [];
  event.seats.forEach((seat) => { (rows[seat.row] ||= []).push(seat); });
  const ownHolds = holds.holds.filter((hold) => hold.seat.event.id === event.id && !hold.uncertain);
  const blocked = !!holds.pending || refreshing || !!error;
  return <div>
    {error && <p role="alert" className="mb-4 text-red-200">{error} <button className="underline" onClick={() => refresh.current()}>Retry availability</button></p>}
    <div className="rounded-3xl p-6 sm:p-10 bg-gradient-to-br from-[#a855f7]/30 via-[#ec4899]/20 to-[#f97316]/20 border border-white/10 glow">
      <span className="px-3 py-1 rounded-full bg-[#a855f7]/30 text-[#d8b4fe] text-xs font-bold">{isPast ? '⏰ EVENT CLOSED' : '✨ UPCOMING EVENT'}</span>
      <h1 className="mt-4 text-3xl sm:text-5xl font-extrabold break-words">{event.title}</h1>
      <p className="mt-4 text-white/60 text-lg break-words">{event.description}</p>
      <div className="mt-6 flex flex-wrap gap-4 text-white/70">
        <span>📍 {event.venue}</span><span>📅 {new Date(event.startsAt).toLocaleString()}</span><span>👤 {event.organizer.name}</span>
      </div>
    </div>

    <div className="mt-10 grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 min-w-0 glass rounded-3xl p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-2xl font-bold">Choose your seat</h2>
          <button onClick={() => refresh.current()} disabled={refreshing || !!holds.pending} className="underline text-sm disabled:opacity-50">{refreshing ? 'Refreshing availability…' : 'Refresh availability'}</button>
        </div>
        <p className="text-white/60 mb-4">{availableCount} of {event.seats.length} available</p>
        <ul id="seat-status-legend" aria-label="Seat status legend" className="flex flex-wrap gap-3 mb-7 text-sm">
          <li className="text-purple-200">Available</li><li className="text-amber-200">Held</li><li className="text-rose-200">Booked</li><li className="text-white/50">Closed</li><li className="text-cyan-200">Your hold</li>
        </ul>
        <div className="space-y-3 overflow-x-auto pb-3" aria-label="Seat grid">
          {rows.map((row, index) => <div key={index} className="flex gap-3 w-max min-w-full justify-center">
            {row.map((seat) => {
              const status = isPast ? 'CLOSED' : seat.status;
              const own = status === 'HELD' && ownHolds.some((hold) => hold.seatId === seat.id);
              const label = own ? 'held by you' : status.toLowerCase();
              return <button key={seat.id} type="button" aria-label={'Seat ' + seat.label + ', ' + label} title={seat.label + ': ' + label}
                aria-pressed={selectedSeat?.id === seat.id} aria-describedby="seat-status-legend"
                disabled={blocked || status !== 'AVAILABLE' || !seat.available} onClick={() => setSelectedSeat(seat)}
                className={'w-12 h-12 shrink-0 rounded-xl flex items-center justify-center text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed ' + (selectedSeat?.id === seat.id ? 'bg-gradient-to-br from-[#ec4899] to-[#f97316] ring-2 ring-white' : own ? 'bg-cyan-400/20 border border-cyan-300 text-cyan-100' : seatStyles[status])}>
                {seat.label}
              </button>;
            })}
          </div>)}
        </div>
        <p className="mt-4 text-sm text-white/50">Availability refreshes automatically. A seat is reserved for you only after your hold succeeds.</p>
      </div>

      <div className="glass rounded-3xl p-6 sm:p-8 h-fit">
        <h3 className="text-xl font-bold mb-6">Hold a seat</h3>
        <div className="space-y-4 text-white/70">
          <div className="flex justify-between"><span>Seat</span><span className="font-bold text-white">{selectedSeat?.label || '—'}</span></div>
          <div className="flex justify-between"><span>Ticket</span><span>{'$' + price.toFixed(2)}</span></div>
          <div className="border-t border-white/10 pt-4 flex justify-between text-xl font-bold text-white"><span>Total</span><span className="gradient-text">{'$' + price.toFixed(2)}</span></div>
        </div>
        <button onClick={() => void handleHold()} disabled={blocked || isPast || !selectedSeat || user?.role === 'ORGANIZER' || user?.role === 'ATTENDEE' && !holds.ready}
          className="mt-8 w-full py-4 rounded-2xl bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f97316] font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed">
          {holds.pending?.startsWith('hold:') ? 'Holding seat…' : isPast ? 'Event closed' : !user ? 'Sign in to hold' : !holds.loaded && user.role === 'ATTENDEE' ? 'Checking your holds…' : 'Hold for 10 minutes'}
        </button>
        <p className="mt-4 text-sm text-white/60">{user?.role === 'ORGANIZER' ? 'An attendee account is required to hold seats.' : 'Hold an available seat, then confirm before the timer ends. Holding does not confirm a booking.'}</p>
        {ownHolds.length > 0 && <p className="mt-4 text-sm text-cyan-100">Your holds are above. {ownHolds.map((hold) => <a key={hold.id} href={'#hold-' + hold.id} className="underline mr-3">Review seat {hold.seat.label}</a>)}</p>}
      </div>
    </div>
  </div>;
}
