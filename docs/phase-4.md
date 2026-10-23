# Phase 4 final test coverage and reliability review — 23 October 2026

Phase 4 reviews the original registration, event creation, booking/history/cancellation, and ten-minute hold requirements. It adds focused coverage and fixes demo initialization without changing application API contracts, database schema, dependencies, or Docker configuration. Phases 5 and 6 have not started. Nothing has been staged, committed, or pushed.

## Coverage review

This is a review of behavior and failure cases, not a claim of complete line coverage. No coverage package or new testing dependency was installed.

| Requirement / risk | Existing evidence | Phase 4 decision |
|---|---|---|
| Organizer/attendee signup and login | Real HTTP tests for both roles, credential validation, password compatibility, duplicate signup, forged/expired/stale-role tokens; frontend signup/API tests | Retain and rerun |
| Organizer event creation | Real API grid creation and authorization tests; UI preserved, but no focused creation-form submission suite | Add six frontend tests for input conversion, acknowledgements, failure/retry, duplicate clicks, free events, fractional-cent rejection, and attendee route exclusion |
| Booking, scoped history and cancellation | Real HTTP ownership/idempotency/rebooking tests and frontend cancellation/session-isolation tests | Add owner cancellation after event start, preserved cancellation timestamp/history, and CLOSED availability |
| Hold creation, ownership, release and confirmation | Thirty-two existing real PostgreSQL hold tests plus frontend hold tests; no public owner disclosure | Retain and rerun |
| Exact expiration and time authority | Database deadline constraints, strict boundary unit tests, real expired fixtures, lock-wait expiry, application-clock skew, monotonic frontend clock tests | Retain and rerun; no ten-minute sleeps or new production clock override |
| Concurrency and database consistency | Twelve competing attendees/confirmations, hold versus booking, confirm versus release, replacement reservation protection, independent-client uniqueness, rollback/retry | Add a real seat-lock timeout HTTP 503 test with unchanged database state and successful subsequent acquisition |
| Refresh/restart and uncertain responses | Actual API subprocess restart tests; frontend recovery/lost-response/session-switch regressions; Phase 3 Chrome fixtures | Retain and rerun automated suites; complete browser-to-real-backend flow remains Phase 5 |
| Populated migrations | Eight real Prisma CLI migration preservation, rollback, reconciliation and recovery tests | Retain and rerun; no migration changes |
| Seed interruption, retries and preservation | Previously untested, non-atomic initialization with an unlocked user-count check | Fix initialization and add eight real PostgreSQL regressions |

No additional authentication, hold, or cancellation production defect was exposed by these added tests. Their existing backend contracts remain unchanged.

## Seed defects and implementation

The old seeder created users, events/seats, and bookings through separate committed writes. A late failure could leave some accounts/events missing, while the next run saw any user and printed "Database already seeded, skipping". Two initializers could also both observe an empty database before either inserted users. These failure/race paths follow directly from the old source; the new regressions prove the corrected behavior under actual database failure and contention.

`server/prisma/seedData.ts` now contains the importable initializer, and `server/prisma/seed.ts` remains the CLI entry point used by the existing startup command:

1. Hash the unchanged demo password before opening a transaction, keeping CPU work outside the lock.
2. Open one Prisma 5.22 READ COMMITTED transaction with a five-second pool wait and fifteen-second transaction timeout.
3. Set a three-second database lock timeout and acquire `LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE` before checking for an existing user. A fresh database has no reservation row suitable for a row lock. This self-conflicting table lock serializes initializers and user writes while allowing ordinary reads, according to [PostgreSQL 16 locking semantics](https://www.postgresql.org/docs/16/explicit-locking.html).
4. If a user exists, return `existing-data` without writing anything. READ COMMITTED sees the committed result of an initializer that held the lock first.
5. Otherwise, create the entire unchanged demo dataset through the transaction: three accounts, three events, 79 seats, and four bookings. Order returned seats by coordinates before assigning demo bookings, rather than relying on unspecified relation order.
6. Commit everything together, or roll back everything on failure. PostgreSQL sequence values can advance on a failed attempt; gaps are harmless and are not repaired/reset.

The CLI reports successful initialization only after commit. On failure it sets exit code 1 and disconnects Prisma; the existing Docker `&&` chain therefore does not start the API after a failed seed. A skip now says existing data was preserved and demo completeness was not verified. No seeded password, role, date, grid, booking, or hold is overwritten on repeat runs.

## Existing partial data policy

Seeding is first-run demo initialization, not an automatic repair tool. This is the deliberate conservative assumption made to satisfy preservation of existing user data.

An already populated database, including a legacy partially seeded database, is preserved exactly. An address matching `organizer@seatbook.test` does not prove an account is safe to overwrite, promote, or assign a public password. Similarly, matching event titles are not reliable ownership identifiers. The seeder does not merge accounts, insert demo reservations into customer events, reset dates/passwords, choose booking winners, or delete data.

Atomicity prevents new partial datasets when this version is interrupted. It does **not** reconstruct missing rows left by an older version. For such a database, inspect the failed seed logs and current records, take a backup/rehearse on a copy, and obtain an explicit reconciliation decision. Add only reviewed missing records through an intentional repair procedure. Do not use `prisma migrate reset`, `db push`, volume deletion, or repeated automatic upserts as a recovery shortcut. No repair or migration was run against the existing application database.

## New regression details

The eight seed tests deploy the real committed migrations into randomly named `seatbook_seed_<uuid>` databases in the isolated test service. They verify:

- Real CLI initialization of every account, bcrypt credential, event/grid, seat assignment, and booking status.
- Repeat runs preserve IDs, password hashes, timestamps, dates, relationships, and reservations exactly.
- Customer edits, changed credentials, cancelled bookings, and active holds remain untouched.
- An existing attendee using the organizer demo email is neither overwritten nor promoted.
- Legacy partial data stays unchanged and the CLI explicitly declines to claim completeness.
- A late SQL trigger failure on the cancelled booking makes the actual CLI exit 1 and leaves all four application tables empty; removing the synthetic failure allows a complete CLI retry.
- Independent Prisma clients starting concurrently produce exactly one complete dataset; one reports `seeded`, the other `existing-data`.
- A SQL trigger pauses a seed transaction after account/event/seat writes. The observer confirms none of those rows is committed, locates only the waiting session in that generated fixture database, terminates it, verifies rollback, and completes a real CLI retry. No arbitrary sleep is used to guess whether the seed reached the interruption point.

The seat-lock timeout regression verifies the exact safe 503 error envelope, zero acquired rows, and one owned HELD row after retry. The cancellation regression verifies foreign-owner rejection, allowed owner cancellation after event start, idempotent timestamps, history preservation, and continued CLOSED availability. These tests did not require production API changes.

## Database and Docker safety

Before any fixture creation, destructive failure injection, or cleanup, the resolved Compose configuration and running container were inspected. The target was:

- Project: `seatbook-phase4-tests`, using only `docker-compose.test.yml`.
- Database container: `seatbook-phase4-tests-db-1` on `seatbook-phase4-tests_default`.
- Database/user confirmed by a read-only SQL query: `seatbook_test` / `seatbook_test`.
- Host port: loopback 55435; application port 5434 was preserved.
- PostgreSQL storage: `/var/lib/postgresql/data` in tmpfs, with no host/application volume bindings.

The existing integration setup validates the dedicated database/user before importing clients or deploying migrations. Seed fixtures additionally validate generated database names and require the same host, port, and user as that guarded target before CLI calls or database removal. Session termination is scoped by PID, current fixture database, and current database user. Fixture databases are dropped only after their clients close. Cleanup stops only this test project, without `-v`; no application services or volumes are operated on.

## Startup/readiness review — Phase 5 work remains

| Verified source behavior | Implication / follow-up |
|---|---|
| PostgreSQL has a `pg_isready` healthcheck; the server depends on it | Server startup waits for PostgreSQL to accept connections |
| Server command runs Prisma generation, migration deploy, seed, then dev server through `&&` | Migration/seed errors prevent API startup; seed success/failure/retry CLI behavior is now integration-tested |
| Client depends on server startup, without an API-health condition | The browser shell can become available before migration/seed/API startup finishes; verify this race and decide on targeted readiness improvements in Phase 5 |
| `/health` returns an unconditional `{ ok: true }` | It is a liveness response, not evidence of a working database/schema; there is no server readiness healthcheck in Compose |
| No automatic Docker restart policy or unbounded seed retry was added | Failures stay visible and retries must be deliberate; temporary lock contention can require retrying startup |
| Compose uses development servers and known demo credentials | It remains a local assessment configuration, not a production deployment design |

This phase built the images and exercised migrations/seed through the isolated tests. It did **not** run the full application Compose stack, a clean application-volume startup, a live browser-to-PostgreSQL walkthrough, or an application-volume restart. Those are Phase 5 acceptance checks, not results claimed here.

## Actual verification

Executed with Node 24, PostgreSQL 16, the locked dependency versions, and the verified disposable project:

| Check | Passed | Failed | Skipped/pending/todo |
|---|---:|---:|---:|
| Frontend tests, six files | 79 | 0 | 0 |
| Backend unit tests, four files | 53 | 0 | 0 |
| PostgreSQL HTTP/hold/migration/seed integration tests, four files | 78 | 0 | 0 |
| **Total** | **210** | **0** | **0** |

The integration total is 29 API, 33 hold, eight migration, and eight seed tests. Phase 4 adds 16 meaningful cases to the previous 194-test revision: six frontend organizer tests and ten PostgreSQL integration cases. Both TypeScript checks, the frontend Vite production build, Docker image builds/Prisma client generation, and `git diff --check` passed. The final backend rerun includes the strengthened real CLI failure/retry assertion. Vitest JSON reports were inspected to confirm every assertion executed and passed, with no skipped suites or todo tests.

Reproduction commands (the recorded runs also used JSON reporters outside the repository):

```bash
docker compose -p seatbook-phase4-tests -f docker-compose.test.yml up -d --wait db
# Verify the project labels, tmpfs/no application mounts, and test DB identity first.
docker compose -p seatbook-phase4-tests -f docker-compose.test.yml run --build --rm server-tests
docker compose -p seatbook-phase4-tests -f docker-compose.test.yml run --build --rm client-tests
docker compose -p seatbook-phase4-tests -f docker-compose.test.yml down
```

No Chrome rerun was needed for a production frontend change: this phase adds frontend tests only. The 17 successful Chrome fixture checks remain Phase 3 evidence, separate from these executed automated tests.

## Remaining risks and final review

- Legacy partial data requires a reviewed repair; the preservation policy above is intentional, not automatic recovery claimed as complete.
- Full clean-start, readiness sequencing, real-stack browser flows, and restart verification remain Phase 5. Final README handover and AI transcript packaging remain Phase 6.
- Existing cross-browser, assistive-technology, sleep/resume, dependency-advisory, localStorage/session-policy, hold-abuse, and production-operations limitations remain as documented in earlier phases. No dependency upgrades or unrelated features were introduced.
- This seed lock briefly blocks user writes and other initializers. It is intended for bootstrapping an empty local database, not online customer-data repair; it is bounded and normal reads remain available.
- Error injection and session termination are isolated test operations. No application database, customer data, Docker volume, or prior migration file was modified.

Final self-review checked transaction boundaries, the lock-before-emptiness ordering, SQL/connection failure rollback, repeat-run data preservation, CLI exit status/disconnection, fixture target guards, existing booking/hold/authentication regressions, and change scope. No remaining defect in these implemented paths was found. No source refactor or endpoint behavior change was made outside seeding.

## Exact file inventory and proposed commits

Eight paths, assigned once, in this suggested order. Review approval is required before staging or committing:

1. `fix(db): make demo seeding atomic` — one transaction, serialized initialization, conservative repeat behavior, accurate CLI outcome, and real PostgreSQL failure/retry/preservation tests. Three files:

   ```text
   server/prisma/seed.ts
   server/prisma/seedData.ts
   server/test/seed.integration.test.ts
   ```

2. `test: cover organizer and booking reliability` — organizer-form, lock-timeout recovery, and post-start cancellation regressions. Three files:

   ```text
   client/src/pages/CreateEventPage.test.tsx
   server/test/api.integration.test.ts
   server/test/holds.integration.test.ts
   ```

3. `docs: record phase four reliability verification` — seed policy, coverage review, actual results, startup findings, and limitations. Two files:

   ```text
   README.md
   docs/phase-4.md
   ```

The pre-existing `server/package-lock.json` modification is excluded and remains untouched/unstaged; its SHA-256 is `629074cd481aa0472032718c69d39c9e14ce5074034c811d315e291358658606`. Both package manifests, both lockfiles, application/test Compose files, port 5434, schema/migrations, and Git history remain unchanged from Phase 4 entry. No secrets, `.env` files, test databases, profiles, or generated artifacts are part of these commits. No staging, commit, push, Phase 5, or Phase 6 work has been performed.
