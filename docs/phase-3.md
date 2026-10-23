# Phase 3 frontend seat holds — 23 October 2026

Frontend implementation using the committed Phase 2 contracts. No backend behavior, schema, migration, package version, or Docker configuration changes. Phase 4 has not started. Nothing has been staged, committed, or pushed.

## Attendee experience

- Select an AVAILABLE seat and choose **Hold for 10 minutes**. Success requires a server acknowledgement; selection alone reserves nothing. The UI no longer uses immediate booking.
- The **Your seat holds** panel appears above the current page for authenticated attendees. Each hold identifies its event and seat, displays its remaining time, and offers explicit confirmation or release. Multiple holds across events are supported, matching the backend.
- Hold controls persist across navigation. On a fresh application mount, the provider retrieves `GET /holds/mine`; it does not persist hold deadlines or ownership locally. An authenticated reopened browser recovers the original server deadlines.
- Successful confirmation removes the hold, updates public availability, and refreshes an already mounted booking history. Confirmed bookings still use the existing history/cancellation page. Release refreshes availability without adding a booking.
- AVAILABLE, HELD, BOOKED, and CLOSED seats have distinct text alternatives and visual styles. Own holds are identified only by matching the authenticated hold response. Public seat metadata never supplies another attendee's identity to the UI.
- Guests are directed to sign in; organizers retain event creation and browsing without attendee-only hold controls. Existing registration/login, history totals, cancellation errors, and protected routes remain covered by regressions.

## API integration

No new endpoints or backend contract changes were needed. See [complete Phase 2 contracts](phase-2.md#api-contracts) for payloads and status codes.

| UI operation | Existing endpoint | Result used |
|---|---|---|
| Load or refresh event | `GET /events/:id` | Seat status, availability, hold deadline, event time, `serverTime` |
| Recover/synchronize own holds | `GET /holds/mine` | Own active holds, nested event/seat metadata, `serverTime` |
| Acquire selected seat | `POST /holds` with `{ "seatId": 10 }` | Hold ID and original deadline; 201/new or 200/reused |
| Confirm | `POST /holds/:id/confirm` | Acknowledged booking and terminal hold |
| Release | `POST /holds/:id/release` | Acknowledged terminal hold |
| Refresh event list/history | `GET /events`, `GET /bookings/mine` | Updated availability or confirmed/cancelled history |

All private requests use the existing bearer-token helper. The existing token comparison still prevents an old session's 401 from clearing a newer session. Public event requests remain unauthenticated.

## Clock and synchronization decisions

For each response, capture monotonic request start/receipt times and parse `serverTime`. Remaining milliseconds are:

```text
max(0, expiresAt - serverTime - requestRoundTrip - monotonicElapsedSinceReceipt)
```

Subtracting the full round trip is deliberately conservative: response delay cannot grant additional time in the UI. Display uses ceiling seconds and updates once per second. Neither `Date.now()` nor a client-generated ten-minute deadline drives hold eligibility. Invalid server time fails visibly rather than silently trusting the browser. Event closure uses the same server clock sample.

The backend enforces the exact ten-minute deadline. The display may reach zero up to approximately one request duration early, plus timer scheduling effects. Periodic synchronization replaces the sample while preserving the original server deadline. Local expiry disables confirmation and triggers recovery/availability requests; it neither creates a replacement hold nor sends a cleanup mutation. A seat is shown as AVAILABLE only after an API snapshot says so.

Recovery and public availability refresh every 15 seconds while the document is visible, and on focus, visibility, online, and page-restoration events. A local event coordinates mounted views after mutations, recovered membership changes, and expiry. A background availability error keeps the last snapshot visible with a retry and disables acquisition; a private synchronization error labels the countdown as last known and blocks ordinary confirmation/acquisition until verified.

## Request failures and races

- One synchronous mutation guard blocks duplicate clicks and competing actions in the current tab before React rerenders. Buttons expose pending labels and disable other mutations. The database remains responsible for exclusivity across users, tabs, and processes.
- Requests have a ten-second timeout covering fetch and body reading. Caller cancellation still propagates; cleanup removes timeout/listeners. Aborting a request does not imply its database transaction was cancelled.
- Acquisition with an uncertain response immediately recovers `/holds/mine` and blocks further acquisition until that recovery succeeds. It does not silently POST again or extend a deadline.
- Confirmation/release with a network, timeout, invalid response, or server failure retains the same hold ID and a clearly labelled retry. Absence from active holds alone is insufficient to claim booking/release success. Same-ID retries use the backend's idempotent terminal responses; My Bookings also remains available to check a confirmation.
- Explicit rejection is surfaced without a success message. Terminal 404/409 results remove the affected card and refresh authoritative state. A 403 clears private controls; a current-session 401 clears authentication through the existing API helper.
- Read revision numbers, AbortControllers, session epochs, and token comparisons discard stale reads and mutation results after newer operations, navigation, logout, or a switch from session A to B. Previous-session holds are hidden synchronously on render, before effect cleanup.
- Public availability is refreshed after every attempted mutation because a rejected/uncertain request may still coincide with a competing successful operation. No optimistic booking or optimistic seat release is shown.

## Accessibility and layout

Seat buttons expose seat labels, state names, and selection state; unavailable seats are disabled. A textual legend supplements color. Countdown elements use `role="timer"` without announcing every second; success/loading messages use status regions and failures use alerts. Newly created hold cards receive focus; recovery does not steal it. Hold cards/buttons wrap on small screens, navigation wraps, and wide seat grids scroll horizontally. The existing glass/gradient design is retained.

## Approved final-review corrections

The final read-only review reproduced two pre-existing defects that were not covered by the original 179 tests. Both were corrected after explicit approval, without changing backend contracts or unrelated features:

1. **Booking-history session isolation.** An already mounted history could show attendee A's bookings under attendee B's navbar, and an outstanding A response could populate B's page. `MyBookingsPage` now renders a history component keyed by the authenticated token. This resets bookings, loading, cancellation state, errors, and success feedback during the same render as a session change, rather than waiting for a cleanup effect. History reads and cancellations carry AbortSignals; their success, failure, and finalization handlers also verify the captured token and signal before updating state. Logout/unmount aborts requests. Cancellation checks the token again after the native confirmation dialog, because another tab can switch accounts while it is open. A synchronous cancellation guard blocks duplicate submissions. Aborting fetch does not undo a database action that already committed; subsequent current-session history remains authoritative.
2. **375px responsiveness.** Event summary cards stack below the existing `sm` breakpoint. Booking summaries use one column on narrow screens and retain three columns on desktop. Booking descriptions can shrink/wrap, action rows wrap within their card, ticket prices remain unbroken, totals can wrap if needed, and cancellation feedback stays within the viewport. Desktop row layouts and the hold UI are preserved.

Fifteen permanent regressions in `client/src/pages/MyBookingsPage.test.tsx` cover populated A → B switches through both same-window and storage events, hiding old rows while B is loading, delayed successful/failed A reads, stale loading/error handlers, delayed successful/failed A cancellations while B has its own cancellation pending, clearing old feedback, logout, switching inside the confirmation dialog, and duplicate clicks. The two existing direct history tests now provide an authenticated attendee session. Mobile geometry is checked in actual Chrome rather than through jsdom class-name assertions, since jsdom does not perform layout.

Only these five paths changed during the correction follow-up:

- `client/src/pages/MyBookingsPage.tsx` — session isolation, cancellation guards, and mobile history layout.
- `client/src/pages/EventsPage.tsx` — narrow-screen summary stacking.
- `client/src/pages/MyBookingsPage.test.tsx` — new session/cancellation regressions.
- `client/src/pages/phase1.test.tsx` — authenticated setup for existing history regressions.
- `docs/phase-3.md` — corrected review status, verification results, and file inventory.

## Executed verification

Automated tests, TypeScript checks, and the production build used Node 24 containers in the separate `seatbook-phase1-tests` Compose project. Its PostgreSQL service uses port 55435, separate credentials/network, and temporary storage. Chrome smoke testing used the installed browser with a separate temporary profile, the production build, and intercepted fixture API responses. No browser API request reached the running application. The application database and its volumes were not used.

| Check | Passed | Failed | Skipped/pending/todo |
|---|---:|---:|---:|
| Frontend clock tests | 8 | 0 | 0 |
| Frontend API tests | 9 | 0 | 0 |
| Existing frontend page regressions, updated for hold-first booking | 10 | 0 | 0 |
| Frontend hold UI/integration regressions | 31 | 0 | 0 |
| Frontend booking-history session/cancellation regressions | 15 | 0 | 0 |
| Existing backend unit tests | 53 | 0 | 0 |
| Existing PostgreSQL HTTP/migration/concurrency integration tests | 68 | 0 | 0 |
| **Total** | **194** | **0** | **0** |

All 73 frontend tests, 53 backend unit tests, and 68 PostgreSQL integration tests passed after the corrections. Frontend `tsc --noEmit` and Vite production build, backend `tsc --noEmit`, and `git diff --check` also passed. Vitest JSON assertion statuses were counted to verify that every test executed and passed. Existing backend tests were rerun as regressions; no Phase 4 backend work was added.

Commands (the verification run also requested JSON reporters to check assertion statuses):

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm client-tests
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm server-tests
```

Frontend coverage includes server/monotonic time, clock jumps, transport allowance, exact expiry boundaries, automatic expiry refresh, failure during recovery, recovery after reopening/navigation/focus/online/page restore, multiple events, confirm/release acknowledgements, duplicate clicks, conflicts, rejected operations, ownership-safe display, current-session expiry, stale session A responses, stale recovery after a mutation, lost creation/confirmation/release responses, mounted booking-history refresh, all seat states, guest/organizer behavior, request/body stalls, and existing page regressions. Backend regression coverage includes real seat-row contention and database-state assertions, expiry while waiting for locks, migration preservation/rollback/recovery, and API restart persistence.

The repeated Chrome smoke run completed **17 checks with zero failures and zero uncaught JavaScript exceptions**, separate from the 194 Vitest tests. It verified keyboard seat selection, focus after acquisition, hold recovery after reload/new-page navigation, confirmation and mounted history refresh, existing cancellation, release, expiry, account switching, and layout. The account changes were made in a second browser tab and delivered through native storage events:

| Browser reproduction/check | Actual result |
|---|---|
| Populated A history → B with an immediate empty history | A's rows disappear; B's private hold/history state contains no A data |
| Delayed A history response after B signs in | A data does not render in B's page |
| Populated A history → B with B's response deliberately delayed | A's rows disappear immediately; B loading remains until B's response arrives |
| Delayed B response | Only B's history is shown |
| Pending A cancellation followed by B login | Old request is aborted; no A success/error feedback updates B's history |
| Event list at 375px | Document client width = scroll width = 375px; summary cards stack (previously scroll width 402px) |
| Populated booking history at 375px | Document client width = scroll width = 375px (previously 404px); actions fit and wrap |
| Maximum supported single ticket price, `$21474836.47` | Ticket and summary value are fully visible at 375px |
| Desktop at 1280px | Booking summaries retain three columns; event summaries retain a horizontal row |

Screenshots were inspected for the mobile event list, populated history, and desktop history. Browser artifacts/profiles and JSON reports remain temporary verification artifacts outside the repository; no browser dependency or new test infrastructure was added.

## Remaining limits and review

- Frontend tests use jsdom and mocked API calls; real PostgreSQL HTTP contracts are tested separately. Chrome smoke/layout checks use intercepted fixtures, so a complete browser-to-PostgreSQL walkthrough remains outstanding. Safari/Firefox, assistive technology, operating-system sleep/resume, and application clean-start verification also remain before submission/launch.
- Availability is a polling snapshot, so another user's changes can remain visible for up to the polling interval plus request delay. Mutation conflicts are handled by authoritative backend responses. No WebSocket/queue/infrastructure was introduced.
- Browsers can throttle timers or pause monotonic clocks during sleep. Focus/visibility/page-restore synchronization corrects the sample; ordinary confirmation is blocked during that private refresh. The server always rechecks expiration.
- Lost-response retry state is in memory. After closing/reopening, active holds are recovered from the server; completed confirmations appear in booking history. The UI does not infer which terminal action occurred from the absence of an active hold.
- The hold coordinator is the most complex frontend component because it handles session/read/mutation races and uncertain responses. It stays within the existing React architecture, with no new state library. Timing math is isolated for direct testing.
- The existing localStorage authentication model, public organizer registration, currency assumptions, and launch hardening/dependency risks documented in earlier phases remain unchanged.

Initial self-review corrected a mounted booking-history refresh gap and added bounded requests to prevent indefinite pending hold controls. The subsequent read-only review found the two additional defects described above; the approved corrections now pass their permanent regressions and original Chrome reproductions. Final self-review checked session cleanup, every history/cancellation asynchronous branch, duplicate submissions, desktop/mobile layout, hold integration, and change scope. No remaining defect in these corrected paths, backend integration defect, or unrelated source change was identified.

## Exact file inventory and proposed commits

Eighteen Phase 3 paths, each assigned once, in dependency order. The additional path is the permanent booking-history regression suite. These are proposals only; review approval is required before staging/committing.

1. `feat(client): coordinate server-timed seat holds` — typed contracts, shared authenticated recovery/mutations, clock math, and bounded request handling with direct tests. Six files:

   ```text
   client/src/types.ts
   client/src/api.ts
   client/src/api.test.ts
   client/src/holdClock.ts
   client/src/holdClock.test.ts
   client/src/holds.tsx
   ```

2. `feat(client): add attendee hold controls` — persistent panel, hold-first selection, availability/history refresh, booking-history session isolation, responsive pages/navigation, and UI regressions. Ten files; depends on commit 1:

   ```text
   client/src/App.tsx
   client/src/components/SeatHolds.tsx
   client/src/components/Navbar.tsx
   client/src/pages/EventDetailPage.tsx
   client/src/pages/EventsPage.tsx
   client/src/pages/MyBookingsPage.tsx
   client/src/pages/MyBookingsPage.test.tsx
   client/src/pages/phase1.test.tsx
   client/src/pages/holds.test.tsx
   client/src/test/holdFixtures.ts
   ```

3. `docs: record frontend hold behavior and checks` — handover, decisions, exact verification and limits. Two files:

   ```text
   README.md
   docs/phase-3.md
   ```

The pre-existing unstaged `server/package-lock.json` modification is excluded and preserved. Its SHA-256 remains `629074cd481aa0472032718c69d39c9e14ce5074034c811d315e291358658606`. Both package manifests and both lockfiles match Phase 3 entry. PostgreSQL port 5434, application Compose files, backend source/migrations, and Git history are unchanged. No secrets, environment files, databases, or generated build/test artifacts are included.
