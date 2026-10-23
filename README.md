# Seatbook

Seat booking for small venues. Organizers publish an event with a seat grid, attendees pick a seat and book it.

## Stack

- **server/**: Node, Express, TypeScript, Prisma, Postgres
- **client/**: React, Vite, TypeScript, Tailwind

## Run it

```bash
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:4000
- Postgres: `localhost:5434` (user / password / db: `seatbook`)

This Compose configuration is for local development, with ports bound to loopback and public demo accounts. The database is migrated and seeded on startup. Keep the application database and its volumes when testing; the separate test project below provides disposable storage.

Demo initialization is atomic and runs only when no users exist. Repeated runs preserve populated databases, including passwords, event dates, booking history, and active holds. Existing partial data from the old seeder requires deliberate reconciliation; startup does not guess ownership, overwrite records, or claim that demo data is complete. See [Phase 4 seed policy and verification](docs/phase-4.md).

**Schema changes:** commit a reviewed migration alongside `schema.prisma`. Use a disposable development database when generating migrations. Container startup regenerates the Prisma client and applies pending migrations. The Phase 1 migration stops on conflicting confirmed bookings, normalized emails, or CHECK violations, reporting the root cause and rolling back all changes. A failed migration requires deliberate reconciliation and Prisma metadata recovery before retrying; see [migration recovery procedures](docs/phase-1.md#migration-diagnostics-and-recovery). Never reset a populated database to resolve this.

The API generates a random local signing secret in `/app/.data/jwt-secret`, persisted in the `api-config` volume. Without Docker it uses `server/.data/jwt-secret`. Production requires a securely supplied `JWT_SECRET` of at least 32 bytes; there is no hardcoded fallback. Changing secrets invalidates sessions. Existing sessions from the original app must sign in again.

Use Node 24 for local development and tests, matching both Docker images. Browser requests use `VITE_API_URL`; the API permits the configured `CLIENT_ORIGIN` (default `http://localhost:5173`).

### Seeded accounts

All passwords are `password123`.

| Email | Role |
|---|---|
| organizer@seatbook.test | Organizer |
| alice@seatbook.test | Attendee |
| bob@seatbook.test | Attendee |

### Without Docker

```bash
cd server && cp .env.example .env && npm install && npm run db:migrate && npm run db:seed && npm run dev
cd client && npm install && npm run dev
```

You need a Postgres running at the `DATABASE_URL` in `server/.env`.

## Scripts

| | server | client |
|---|---|---|
| `npm run dev` | API with reload | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` | `tsc --noEmit` |
| `npm test` | Vitest unit tests | Vitest + jsdom component/API tests |
| `npm run test:integration` | HTTP + populated migration/recovery tests on real PostgreSQL | — |

## Isolated PostgreSQL regression tests

From the repository root:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm server-tests
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm client-tests
```

This runs the backend typecheck, unit tests, migrations, and integration tests inside Node 24. The test database has separate credentials, a separate Docker network, port 55435, and temporary storage. It never mounts the application's `db-data` volume. Migration tests additionally create randomly named databases in that isolated PostgreSQL instance, deploy the original schema, populate legacy fixtures, then exercise upgrade, rollback, and recovery using the real Prisma CLI. Those fixture databases are dropped after each test.

For a host-side test run:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml up -d --wait db
cd server
TEST_DATABASE_URL=postgresql://seatbook_test:seatbook_test@127.0.0.1:55435/seatbook_test npm run test:integration
```

The harness requires `TEST_DATABASE_URL` and refuses databases/users other than `seatbook_test`. To stop the test project, run `docker compose -p seatbook-phase1-tests -f docker-compose.test.yml down` from the repository root. This discards **only test** temporary storage.

From `client/`, run `npm test` and `npm run build` for frontend verification.

## Phase 1 review status

Implemented: JWT configuration/claim validation, current database identity and role checks, owner-only cancellation, input validation, safe errors, authentication throttling, consistent seat availability, PostgreSQL constraints, transactional booking/cancellation, organizer registration, and frontend request/error handling. A row lock serializes seat mutations; a partial unique index independently prevents two confirmed bookings for one seat. Cancellation is idempotent and preserves history.

Assumptions: organizer registration is public; bookings are attendee-only; cancellation remains allowed after event start; free tickets are valid; email identity is trimmed and lowercase. Registration passwords require 12 characters and at most 72 UTF-8 bytes. Login preserves existing bcrypt behavior, including short demo passwords and legacy inputs exceeding 72 bytes, without trimming, truncating, or rehashing them. Login input is bounded by the API's 32 KiB JSON body budget (including JSON overhead), with a matching upper bound in validation. Currency remains the existing USD display. The unsupported frontend service fee was removed; no payment functionality exists.

Phase 1 verification is recorded in [docs/phase-1.md](docs/phase-1.md). Full clean application startup, broader browser testing, launch hardening, and final handover/transcript packaging remain for later phases. Development Compose is not a production deployment configuration. The per-process authentication limiter would need shared enforcement if multiple API instances were deployed.

An actual AI mistake: I initially chose frontend Vitest 5 without checking its Vite peer range. npm rejected Vite 5. An attempted older compatible Vitest introduced critical transitive advisories, so I checked package metadata and the audit report and moved to patched Vite 6.4.5 with Vitest 5. I did not bypass peer checks with `--force` or rewrite the application. Final verification results are recorded in `docs/phase-1.md`.

## Phase 2 backend holds

Attendees can hold a seat for exactly ten minutes using PostgreSQL time, recover active holds after refresh/restart, explicitly confirm, or release. Repeated active-hold requests do not extend the deadline. Expired holds stop affecting availability immediately; the next seat mutation reconciles them without a background worker. One partial unique index prevents both competing holds and hold-versus-booking conflicts, with seat-row locks serializing mutations.

The existing immediate-booking endpoint remains available for unheld seats. A hold owner must use its confirmation endpoint; active holds cannot be bypassed through immediate booking. Confirmed hold reservations appear in the existing booking history and support the existing cancellation endpoint.

See [Phase 2 API contracts, migration design, guarantees, verification, and remaining risks](docs/phase-2.md). Its two migrations are additive to the committed migration history and have only been applied to isolated test databases during development. Do not run them against the application database without separate approval.

## Phase 3 attendee holds

Select an available seat and choose **Hold for 10 minutes**. The **Your seat holds** panel stays available across pages: confirm before the deadline to book, or release the seat. Held, booked, and closed seats cannot be selected. Only your own recovered holds are identified as yours; public seat data never identifies another attendee.

The countdown uses the API's database `serverTime`, the original `expiresAt`, and monotonic elapsed time. It does not reset after refresh, navigation, reopening, or changing the computer's clock. Active holds are recovered from `GET /holds/mine`, without a local hold cache. A conservative transport allowance can make the display reach zero slightly early; the backend always makes the final decision.

Availability refreshes after operations and expiry, every 15 seconds while visible, and when the page regains focus, becomes visible, returns online, or is restored. Network failures retain explicit errors and safe retries; a lost confirmation/release response retries the same reservation ID rather than claiming success. Requests time out after ten seconds, including stalled response bodies. Full browser/visual testing and clean application startup verification remain for later phases.

See [Phase 3 implementation, verification, limitations, and proposed commits](docs/phase-3.md).

## Phase 4 reliability review

The final coverage review added real PostgreSQL seed rollback/interruption/retry and concurrent-initialization tests, seat-lock timeout/retry coverage, cancellation after event start, and organizer-form regressions. The latest run passed 210 tests: 79 frontend, 53 backend unit, and 78 PostgreSQL integration tests, with no failures or skips. Both TypeScript checks and the frontend production build passed.

See [Phase 4 coverage, seed design, startup findings, and remaining risks](docs/phase-4.md). Full application clean-start and browser-to-real-backend verification remain Phase 5; they have not been performed against the existing application database.

## API

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/auth/register` | none | Create an account, returns a token |
| POST | `/auth/login` | none | Log in, returns a token |
| GET | `/events` | none | List events with seats left |
| GET | `/events/:id` | none | One event with its seat map |
| POST | `/events` | organizer | Create an event and its seats |
| POST | `/bookings` | attendee | Immediately book an unheld seat |
| GET | `/bookings/mine` | attendee | Your bookings |
| POST | `/bookings/:id/cancel` | attendee | Cancel a booking |
| POST | `/holds` | attendee | Hold a seat; reuse an existing own active hold without extending it |
| GET | `/holds/mine` | attendee | Recover your active holds and server time |
| POST | `/holds/:id/confirm` | attendee | Confirm your hold; retries return the same booking |
| POST | `/holds/:id/release` | attendee | Release your hold; repeated release is safe |

Send the token as `Authorization: Bearer <token>`.
