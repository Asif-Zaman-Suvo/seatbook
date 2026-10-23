import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../auth';
import { countdown, remainingMs } from '../holdClock';
import { TimedHold, useHolds } from '../holds';

function SeatHoldCard({ hold }: { hold: TimedHold }) {
  const { now, ready, pending, focusHoldId, confirm, release, syncing, syncError } = useHolds();
  const card = useRef<HTMLElement>(null);
  const remaining = remainingMs(hold.expiresAt, hold.clock, now);
  const closed = remainingMs(hold.seat.event.startsAt, hold.clock, now) === 0;
  useEffect(() => { if (focusHoldId === hold.id) card.current?.focus(); }, [focusHoldId, hold.id]);
  const button = 'rounded-xl px-4 py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';
  return <article ref={card} id={`hold-${hold.id}`} tabIndex={-1} aria-label={`Your hold for seat ${hold.seat.label} at ${hold.seat.event.title}`} className="min-w-0 rounded-2xl border border-cyan-300/30 bg-cyan-400/5 p-5 focus:outline focus:outline-2 focus:outline-cyan-300">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link to={`/events/${hold.seat.event.id}`} className="font-bold underline break-words">{hold.seat.event.title}</Link>
        <p className="text-white/70">Your seat {hold.seat.label} · {hold.seat.event.venue}</p>
      </div>
      {hold.uncertain ? <p className="text-amber-200">Awaiting {hold.uncertain === 'confirm' ? 'booking' : 'release'} status</p> : remaining === 0 || closed
        ? <p className="font-semibold text-amber-200">{closed ? 'Event started' : 'Hold expired'}</p>
        : <div className={remaining <= 60_000 ? 'text-amber-200' : 'text-cyan-100'}>
          <span className="block text-xs">{syncing ? 'Checking hold status…' : syncError ? 'Last known time remaining' : 'Time remaining'}</span>
          <span role="timer" aria-label={`Time left for seat ${hold.seat.label}`} aria-live="off" className="font-mono text-3xl tabular-nums">{countdown(remaining)}</span>
        </div>}
    </div>
    {hold.uncertain && <p className="mt-3 text-sm text-amber-100">The previous response was lost. Retry the same request to check its result.{hold.uncertain === 'confirm' && <> You can also check <Link to="/my-bookings" className="underline">My Bookings</Link>.</>}</p>}
    <div className="mt-4 flex flex-col sm:flex-row gap-3">
      <button onClick={() => void confirm(hold)}
        disabled={!!pending || hold.uncertain === 'release' || !hold.uncertain && (!ready || remaining === 0 || closed)}
        className={`${button} bg-gradient-to-r from-[#a855f7] to-[#ec4899]`}>
        {pending === `confirm:${hold.id}` ? `Confirming seat ${hold.seat.label}…` : `${hold.uncertain === 'confirm' ? 'Retry confirmation for' : 'Confirm'} seat ${hold.seat.label}`}
      </button>
      <button onClick={() => void release(hold)} disabled={!!pending || hold.uncertain === 'confirm' || !hold.uncertain && remaining === 0} className={`${button} border border-white/30`}>
        {pending === `release:${hold.id}` ? `Releasing seat ${hold.seat.label}…` : `${hold.uncertain === 'release' ? 'Retry release for' : 'Release'} seat ${hold.seat.label}`}
      </button>
    </div>
  </article>;
}

export default function SeatHolds() {
  const holds = useHolds();
  const user = useUser();
  if (user?.role !== 'ATTENDEE') return null;
  if (holds.loaded && !holds.holds.length && !holds.syncError && !holds.actionError && !holds.notice) return null;
  const errors = [...new Set([holds.actionError, holds.syncError].filter(Boolean))].join(' ');
  return <section aria-label="Your seat holds" className="mb-8 glass rounded-3xl p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 className="text-xl font-bold">Your seat holds</h2>
      <button onClick={() => void holds.refresh()} disabled={holds.syncing || !!holds.pending} className="underline text-sm disabled:opacity-50">{holds.syncing ? 'Refreshing holds…' : 'Refresh holds'}</button>
    </div>
    {!holds.loaded && !errors && <p role="status">Recovering your seat holds…</p>}
    {errors && <p role="alert" className="mb-4 text-red-200">{errors}</p>}
    {holds.notice && <p role="status" className="mb-4 text-cyan-100">{holds.notice}</p>}
    <div className="grid gap-4 md:grid-cols-2">{holds.holds.map((hold) => <SeatHoldCard key={hold.id} hold={hold} />)}</div>
    {!holds.holds.length && holds.loaded && <p className="text-white/60">No active seat holds.</p>}
  </section>;
}
