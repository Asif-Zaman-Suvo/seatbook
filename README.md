# Seatbook

Seat booking for small venues. Organizers create events with seat grids and ticket prices. Attendees browse events, hold an available seat for ten minutes, then confirm or release it. Confirmed bookings appear in booking history and can be cancelled.

This take-home preserves the existing registration, event creation, booking, history, and cancellation features while adding exclusive holds and security/reliability improvements. Payments, email, notifications, password reset, 2FA, and deployment infrastructure are outside scope.

**Stack:** `server/` uses Node, Express, TypeScript, Prisma, and PostgreSQL; `client/` uses React, Vite, TypeScript, React Router, and Tailwind.

## Run locally

With Docker Desktop running and the default ports available:

```bash
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:4000
- PostgreSQL: `localhost:5434` (user / password / database: `seatbook`)

Compose is a local development configuration with loopback ports and public demo credentials. Startup generates the Prisma client, applies migrations, seeds an empty database, and starts the API. The client waits for API readiness. Database state and the development signing secret persist in separate named volumes.

Seeding is atomic and runs only when no users exist. Repeated runs preserve populated databases, including passwords, dates, bookings, and holds. Legacy partial demo data requires deliberate reconciliation; startup preserves it without claiming completeness. See [seed policy and verification](docs/phase-4.md).

**Existing databases:** review pending migrations, take a backup, and rehearse on a copy before starting an upgrade. Conflicting confirmed bookings, normalized emails, or invalid legacy values stop the integrity migration and roll back its changes. Follow the [migration diagnostics and Prisma recovery procedure](docs/phase-1.md#migration-diagnostics-and-recovery); never reset a populated database or remove its volumes to bypass a failure. Commit a reviewed migration alongside each schema change, generating it against a disposable database.

### Demo accounts

All demo passwords are `password123`.

| Email | Role |
|---|---|
| organizer@seatbook.test | Organizer |
| alice@seatbook.test | Attendee |
| bob@seatbook.test | Attendee |

### Configuration

Use Node 24 for local development and tests, matching the Docker images.

| Variable | Used by | Configuration |
|---|---|---|
| `DATABASE_URL` | Server / Prisma | Compose uses its internal PostgreSQL service; host setup uses `server/.env`, with PostgreSQL on port 5434 |
| `PORT` | Server | Default `4000` |
| `JWT_SECRET` | Server | Production requires a securely supplied secret of at least 32 bytes |
| `CLIENT_ORIGIN` | Server | Single permitted browser origin; default `http://localhost:5173` |
| `VITE_API_URL` | Client | API URL; default `http://localhost:4000` |

Local development generates a random signing secret in `/app/.data/jwt-secret`, persisted by the `api-config` volume; host development uses `server/.data/jwt-secret`. There is no hardcoded signing fallback. Changing the secret invalidates existing sessions; sessions issued by the original application require a new login.

### Without Docker

Use Node 24 and a running PostgreSQL instance. For a fresh setup, open a terminal from the repository root:

```bash
cd server
cp .env.example .env
npm install
npx prisma generate
npm run db:migrate
npm run db:seed
npm run dev
```

Retain an existing `.env` instead of overwriting it. Set its `DATABASE_URL` to the intended database before migrating or seeding. Regenerate Prisma after schema changes to avoid stale generated types.

In a second terminal, from the repository root:

```bash
cd client
npm install
npm run dev
```

## What changed and why

| Problem | Change and resulting behavior |
|---|---|
| Insecure identity handling and cancellation authorization | Validated JWTs, current database roles, and owner-scoped operations prevent forged/stale privileges and foreign cancellations |
| Competing requests could double-book | Seat-row transactions and database uniqueness allow one live reservation per seat |
| No temporary reservation | Persistent ten-minute holds support explicit confirmation, release, expiry, and recovery |
| Stale responses and misleading UI feedback | Session isolation, bounded requests, pending controls, and server acknowledgements prevent private-state leaks and false success |
| Interrupted or concurrent demo initialization | One locked transaction creates the complete dataset or rolls back; repeat runs preserve existing records |
| Frontend could start before the API | Database-backed readiness and Compose health ordering gate client startup |

## How ten-minute holds work

Select an AVAILABLE seat and choose **Hold for 10 minutes**. Selection alone reserves nothing. After server acknowledgement, the **Your seat holds** panel shows the event, seat, countdown, and confirm/release controls across pages. HELD, BOOKED, and CLOSED seats are unavailable for selection; public seat data never identifies another attendee.

```text
AVAILABLE -> HELD -> CONFIRMED -> CANCELLED -> AVAILABLE
               +-> RELEASED -> AVAILABLE
               +-> EXPIRED  -> AVAILABLE
```

`AVAILABLE` is derived. Holds use the existing `Booking` table; confirmation keeps the same reservation ID. A partial unique index permits at most one HELD or CONFIRMED row per seat. All seat mutations lock that seat row, read PostgreSQL time after lock waits, and reconcile expired holds inside a transaction. Confirmation checks database time again in its UPDATE. Database constraints enforce the exact ten-minute timestamp interval.

Expired holds stop affecting availability immediately, even before their stored status is reconciled. No Redis, cron, queue, or worker is required. Repeated own-hold requests return the original deadline. Only the owner can confirm or release; confirmation/release retries are idempotent. A confirmed booking no longer expires at its former hold deadline.

The countdown uses backend `serverTime`, the original `expiresAt`, and monotonic `performance.now()` elapsed time, with the request duration subtracted conservatively. It can reach zero slightly early; the backend decides eligibility. Refresh, navigation, or authenticated reopening recovers active holds from `GET /holds/mine` without resetting deadlines. Availability refreshes after operations/expiry, every 15 seconds while visible, and on focus, visibility, online, and page-restoration events.

Requests time out after ten seconds, including stalled response bodies. Uncertain confirmation/release responses retain an explicit same-ID retry rather than claiming success. Existing `POST /bookings` remains compatible for unheld seats; an active hold, including the caller's own, must use its confirmation endpoint. Confirmed holds use the existing booking history and cancellation flow. See [backend contracts](docs/phase-2.md) and [frontend synchronization](docs/phase-3.md).

## Security and reliability improvements

- JWT validation restricts algorithm, issuer, audience, subject, and expiry; authorization reads the current database identity/role. Authentication attempts are throttled per API process.
- Attendee operations enforce ownership; foreign hold/booking IDs return controlled errors. Password hashes and SQL diagnostics are excluded from public responses.
- Shared input validation, a 32 KiB JSON budget, foreign keys, CHECK constraints, and reservation indexes protect application and database boundaries. Errors use consistent HTTP statuses and an `error` object containing `code` and `message`.
- Token-scoped 401 handling, aborted stale reads, session guards, and token-keyed history prevent session A's results or feedback from appearing under session B. Cancellation is idempotent and preserves history.
- `/health` reports process liveness. `/ready` checks access to the four core tables, returning 200 when ready or a safe 503 on failure. Compose waits for PostgreSQL health, then API readiness, before client startup. Runtime health failure does not automatically restart services.

## Testing and verification

Recorded Phase 5 verification, 23–24 October 2026, used Node 24 containers and isolated PostgreSQL 16:

| Automated suite | Passed | Failed | Skipped/pending/todo |
|---|---:|---:|---:|
| Frontend | 79 | 0 | 0 |
| Backend unit | 53 | 0 | 0 |
| PostgreSQL integration | 80 | 0 | 0 |
| **Total** | **212** | **0** | **0** |

Both TypeScript checks, the frontend production build, and `git diff --check` passed. Coverage includes authentication/ownership, session privacy, expiration, transaction rollback, migration preservation/recovery, seed interruption/retry, and concurrency with persisted database-state assertions. Twelve competing booking requests produce one successful booking and eleven conflicts, with the stored winner matched to its response. These are test counts, not a measured code-coverage percentage.

**17 separate real Chrome checks passed**, with no JavaScript exceptions, against the actual frontend, API, and PostgreSQL. They cover organizer/attendee flows, exclusivity, confirmation/cancellation, release/expiry, concurrent requests, 375px layout, refresh/reopening, API restart, and database outage/recovery. Readiness returned 503 during the isolated database outage and 200 after recovery. Frontend component tests use mocked APIs; the Phase 5 browser checks did not. Expiry uses isolated timestamp fixtures preserving the ten-minute interval, rather than a natural ten-minute wait.

**Exact clean-start verification — 25 October 2026:** commit `83ce32481a7b623b0359ef67ad120118c18f4e5d` successfully ran the literal `docker compose up --build` in an independent temporary checkout. Only base Compose was used, with its development bind mounts and default ports 5434/4000/5173; `COMPOSE_PROJECT_NAME=seatbook-final-exact-20261025` isolated the new resources through the dedicated shell environment. Fresh volumes received all four migrations and the expected 3 users / 3 events / 79 seats / 4 bookings. PostgreSQL and API readiness passed, followed by frontend availability.

A separate real Chrome run against that fresh stack passed **17 checks with zero failures or recorded JavaScript exceptions**. The previously completed **212 automated tests were not rerun** during this verification. This extends the earlier override-based startup evidence; browser serving still used development Vite, and the production bundle was built separately. Only the six new verification resources were subsequently removed, preserving all original Docker resources. The final evidence is privately archived, not published or a portable committed E2E suite. See the [dated Phase 5 addendum](docs/phase-5.md#final-verification-and-cleanup-addendum--25-october-2026) for details and limitations.

### Reproduce automated tests

From the repository root, with test port 55435 available:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm server-tests
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm client-tests
```

The services run backend typechecking/unit/integration tests and frontend tests/typechecking/production build. Their PostgreSQL instance has separate credentials/network and tmpfs storage; it never mounts the application's `db-data`. The integration harness requires database/user `seatbook_test`; migration and seed fixtures create and drop guarded, randomly named databases only within that isolated instance. Inspect project identity and mounts before fixture execution or cleanup.

For host-side integration tests:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml up -d --wait db
cd server
npx prisma generate
TEST_DATABASE_URL=postgresql://seatbook_test:seatbook_test@127.0.0.1:55435/seatbook_test npm run test:integration
```

From the repository root, `docker compose -p seatbook-phase1-tests -f docker-compose.test.yml down` stops only that test project and discards its temporary database storage. Do not target the application project or remove its volumes.

| Script | Server | Client |
|---|---|---|
| `npm run dev` | API with reload | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` | `tsc --noEmit` |
| `npm test` | Vitest unit tests | Vitest + jsdom component/API tests |
| `npm run test:integration` | Real PostgreSQL HTTP, hold/concurrency, migration, and seed tests | — |
| `npm run build` | — | TypeScript check and Vite production build |

## API reference

Send authenticated requests with `Authorization: Bearer <token>`. The API enforces current roles and ownership; frontend route guards are additional UI controls.

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/auth/register` | none | Create an account, returns a token |
| POST | `/auth/login` | none | Log in, returns a token |
| GET | `/events` | none | List events with seats left |
| GET | `/events/:id` | none | One event with its seat map |
| POST | `/events` | organizer | Create an event and its seats |
| POST | `/bookings` | attendee | Immediately book an unheld seat |
| GET | `/bookings/mine` | attendee | Your confirmed/cancelled bookings |
| POST | `/bookings/:id/cancel` | attendee | Cancel your booking; repeating cancellation is safe |
| POST | `/holds` | attendee | Hold a seat; reuse an existing own active hold without extending it |
| GET | `/holds/mine` | attendee | Recover your active holds and server time |
| POST | `/holds/:id/confirm` | attendee | Confirm your hold; retries return the same booking |
| POST | `/holds/:id/release` | attendee | Release your hold; repeated release is safe |
| GET | `/health` | none | Process liveness |
| GET | `/ready` | none | Core database readiness; 503 when unavailable |

Hold creation accepts `{ "seatId": 12 }`, returning 201 for a new hold or 200 for an existing own active hold. Recovery and mutation responses include `serverTime`; detailed payloads and error codes are in [Phase 2 API contracts](docs/phase-2.md#api-contracts).

## Assumptions and known limitations

- Organizer registration is public; only attendees book/hold seats. Multiple holds per attendee are allowed without a quota. Events close at their start time, which can end confirmation eligibility before a hold's ten-minute deadline.
- Cancellation remains allowed after event start. Free tickets are valid; prices retain the existing USD display. No payment is collected, and the unsupported frontend service fee was removed.
- Emails are trimmed/lowercase. New passwords require at least 12 characters and at most 72 UTF-8 bytes. Login preserves existing bcrypt behavior, including short demo passwords and legacy inputs over 72 bytes, within the 32 KiB JSON request budget; credentials are not trimmed, truncated, or rehashed on login.
- Availability is a polling snapshot. Another user's change may take one polling interval plus network delay to appear, but every mutation rechecks database state.
- Browsers can throttle timers or pause during sleep. Focus/visibility synchronization refreshes the sample; the backend always rechecks expiry. Safari/Firefox, physical devices, screen readers, and long OS sleep/resume were not fully verified.
- Legacy partial demo data needs reviewed repair. Readiness checks core table access, not every schema constraint or write path; migration/integration tests provide separate checks.

## Before production launch

These are launch considerations, separate from the remaining assignment submission work:

- Before accepting real payments, integrate a payment provider with verified, idempotent callbacks and define payment deadlines relative to the ten-minute hold. A late payment must not confirm an expired or reassigned seat; define an explicit void/refund policy.
- Plan email verification to establish address ownership and secure password recovery for lost credentials, using expiring, single-use tokens and abuse limits. Neither flow is implemented; both remain outside this assignment's scope.
- Supply a strong production `JWT_SECRET`, remove public demo credentials, and review HTTPS, XSS protection, and the current seven-day localStorage bearer-token policy.
- Review public organizer access and hold-abuse limits. If using multiple API instances, replace process-local authentication throttling with shared enforcement or an appropriate edge policy.
- Reassess the [documented dependency advisories and reachability](docs/phase-1.md#dependency-review-retained-from-the-follow-up-audit), applying reviewed compatible fixes. No current clean-audit claim is made.
- Rehearse backups/restores and populated migrations, including table-lock impact and deliberate conflict reconciliation. Review operational monitoring, expected load, accessibility, and the additional browser cases above. Compose still runs development servers; deployment infrastructure is outside this assignment.

## Weakest part of the implementation

The frontend hold coordinator in `client/src/holds.tsx` is the most complex component to maintain: it coordinates session changes, overlapping reads/mutations, expiry, and uncertain network responses. Regression tests cover these races, but uncertain-action retry state is held only in memory. After reopening, active holds recover from the server; completed confirmations must be checked in booking history. Reservations remain durable in PostgreSQL. A future improvement would make the frontend state transitions more explicit while preserving the API contracts.

## One place AI was wrong

AI initially paired Vitest 5 with the existing Vite 5 frontend without checking peer compatibility. npm rejected the combination. An older compatible runner then exposed critical transitive advisories. Reviewing package metadata and audit results led to Vite 6.4.5 with Vitest 5, followed by Docker installation, tests, TypeScript checks, and the production build. No `--force` bypass was used. This genuine incident is recorded in [Phase 1](docs/phase-1.md#genuine-ai-mistakes-recorded).

## Assignment submission status

- [x] Complete the exact standard-command fresh-start verification without touching the existing application database.
- [x] Package, review, and commit the filtered/redacted [AI development evidence](ai-transcripts/README.md), included in commit `83ce324`.
- [ ] Submit the repository link through the supplied form by 30 October 2026, end of day Bangladesh time; form completion has not been verified.

The [GitHub repository](https://github.com/Asif-Zaman-Suvo/seatbook) was verified publicly accessible on 25 October 2026, with remote `main` matching local commit `83ce324`. Public access satisfies the assignment's repository-access requirement.

## Detailed implementation notes

| Document | Evidence |
|---|---|
| [Phase 1](docs/phase-1.md) | Security hardening, booking integrity, validation, dependency assessment, migration recovery |
| [Phase 2](docs/phase-2.md) | Hold schema, API contracts, locking, database time, idempotency, populated migrations |
| [Phase 3](docs/phase-3.md) | Frontend synchronization, countdown, session privacy, accessibility, responsive layout |
| [Phase 4](docs/phase-4.md) | Atomic seeding, interruption/retry, preservation, added regressions |
| [Phase 5](docs/phase-5.md) | Readiness, isolated fresh startup, 212 tests, 17 real browser checks, verification limits |

The phase documents record their historical verification checkpoints; this README consolidates the completed implementation and remaining handover work.
