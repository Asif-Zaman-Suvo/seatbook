# Phase 1 review — 22 October 2026

Phase 1 is implemented and verified. Seat holds have not been started. No files have been staged, no commits have been created, and no history has been rewritten or pushed.

## Changed files and reasons

| Files | Reason |
| --- | --- |
| `server/src/config.ts`, `middleware/auth.ts`, `routes/auth.ts` | One signing/verification configuration; random persisted development secret; production secret requirement; HS256/issuer/audience/expiration/subject validation; current database identity/roles; normalized registration and safe user responses. |
| `server/src/app.ts`, `index.ts`, `http.ts`, `validation.ts`, `middleware/authRateLimit.ts` | Importable Express application for HTTP tests; async error forwarding; safe structured errors; bounded request bodies and inputs; explicit CORS; no API response caching; bounded process-local authentication throttling; graceful shutdown. |
| `server/src/services/bookingService.ts`, `routes/bookings.ts` | Seat-row locks and short READ COMMITTED transactions for both booking and cancellation; current database clock; attendee authorization; owner-scoped cancellation; idempotent cancellation; scoped booking history. |
| `server/src/routes/events.ts`, `services/eventService.ts`, `utils/helpers.ts` | Strict organizer/event validation, numeric IDs, real 404 responses, consistent cancelled/past-event availability, smaller relation projections, integer cents in response contracts. |
| `server/prisma/schema.prisma`, `migrations/20261022000000_booking_integrity/migration.sql` | Partial unique confirmed-seat index, query indexes, grid/price/coordinate/cancellation/email checks. Migration detects conflicting existing seats/emails, normalizes existing email text, and rolls back on failure; it never deletes records or chooses booking winners. |
| `client/src/api.ts`, `auth.ts`, `types.ts` | One configurable typed API client; HTTP/network error handling; token-scoped expired-session clearing; safe stored-user parsing; synchronized authentication state. |
| `client/src/App.tsx`, `components/Navbar.tsx` | Role-aware protected routes and navigation; safe logout and missing-page handling. |
| `client/src/pages/LoginPage.tsx` | Organizer/attendee signup selection; form validation and pending/error states; separate registration and legacy-login password bounds. |
| `client/src/pages/EventsPage.tsx`, `EventDetailPage.tsx` | Controlled loading/error/retry states; aborted stale reads; pending booking controls; occupied/past seats disabled; accessible seat buttons; supported ticket price without a fabricated service fee. |
| `client/src/pages/MyBookingsPage.tsx`, `CreateEventPage.tsx` | Cancellation success only after an accepted response; correct status totals/actions; event form validation; bounded seat preview and pending submissions. |
| `server/test/**`, `server/vitest*.mts`, `server/package.json`, `server/tsconfig.json` | Unit and real HTTP/PostgreSQL regressions, separate integration configuration, explicit disposable-database guard, and typechecked test configuration. |
| `client/src/api.test.ts`, `pages/phase1.test.tsx`, `test/setup.ts`, `client/vitest.config.mts`, `client/package.json`, `client/package-lock.json` | API/component regressions using Vitest, jsdom, and Testing Library; patched Vite 6.4.5 and Vitest 5.0.5. |
| `docker-compose.yml`, both Dockerfiles, `docker-compose.test.yml` | Node 24; local loopback bindings; persisted development secret; separate disposable PostgreSQL and containerized backend/frontend checks. |
| `.gitignore`, `server/.dockerignore`, `server/.env.example`, `README.md`, this file | Exclude generated secrets; retain port 5434 in documentation; document migration behavior, assumptions, reproduction commands, and incomplete work. |

The PostgreSQL host port remains **5434**, preserving the user's existing port choice. The pre-existing `server/package-lock.json` diff is untouched; it is not an implementation change.

## Correctness argument

All booking/cancellation operations lock the existing `Seat` row before checking or changing reservation state. Competing transactions for that seat wait, then read the committed result. The database also permits only one `CONFIRMED` booking per seat through a partial unique index, including writes that bypass the service.

Cancellation scopes the booking to its owner, locks the same seat, and re-reads its status. Repeating cancellation preserves the original timestamp. Retrying cancellation of old history cannot cancel a later booking on the seat. Cancelled rows remain available as history and no longer count as occupancy.

The current booking endpoint remains immediate booking. Its contract is still `POST /bookings` with a numeric `seatId`. Holds and their API changes require Phase 2 approval.

## Executed verification

The approved follow-up corrections were verified on 22 October 2026 using the Node 24 Docker test services and isolated PostgreSQL 16. Earlier local runs covered the previous 78-test revision; the current counts below supersede that result.

| Check | Actual result |
| --- | --- |
| Backend `npm run typecheck` | Passed in Node 24 Docker, including the new migration test suite |
| Backend `npm test` | 45 tests passed across 4 files |
| Backend `npm run test:integration` | 35 tests passed: 28 HTTP/API tests and 7 populated migration tests |
| Frontend `npm test` | 16 tests passed across 2 files |
| Frontend `npm run build` | TypeScript check and Vite production build passed |
| Server/client Docker image builds | Passed; locked dependency layers reused, Prisma client generation passed |
| Test totals | 96 passed; no failed, skipped, pending, or todo tests |
| Prior client audit review (dependencies unchanged in this follow-up) | npm reports 5 high and 4 moderate package entries; production-only audit reports 2 moderate |
| `git diff --check` | Passed |

The final rerun used Vitest JSON reports: every assertion had status `passed`; totals were 45/45 unit, 35/35 integration, and 16/16 frontend, with zero failed/pending/todo entries and no skipped assertions. The final backend rerun includes the strengthened database/winning-response concurrency assertions. Backend typechecking and frontend typechecking/production build passed in those same runs.

Reproduce the container checks from the repository root:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm server-tests
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm client-tests
```

Backend coverage includes both registration roles, short demo passwords, existing ASCII and multibyte bcrypt passwords exceeding 72 bytes, unchanged stored hashes, rejection of those passwords for new registrations, request-size bounds, malformed inputs, JWT attacks and expiration, stale signed roles, account existence, authentication throttling, organizer event creation, safe failures, owner-only history/cancellation, cancellation retries/rebooking, started events, independent database-client uniqueness, actual constraint failures, and transaction rollback.

The twelve-request concurrency regression requires exactly one HTTP 201 and eleven HTTP 409 responses. It also queries PostgreSQL: exactly one booking row exists, it is confirmed, and its ID/owner match the winning HTTP response.

Frontend coverage includes the delayed session A 401 arriving after session B signs in (B remains stored), current-token 401 logout, unchanged long ASCII/multibyte login submission, registration bounds, organizer role submission, successful booking and availability refresh, occupied-seat controls, failed cancellation without false success, cancelled-booking totals, login redirection, invalid stored user JSON, network/non-JSON errors, and recoverable event loading failures. React Router emits its existing v7 future-flag notices; there were no test failures.

The permanent migration suite deploys the original checked-in migration through Prisma before inserting legacy users, past/future events, seats, and confirmed/cancelled booking history. The successful upgrade preserves all IDs, hashes, timestamps, content, relationships, and bookings; only email normalization changes. Redeployment is idempotent and the partial unique index rejects duplicate direct writes. Six failure/recovery cases cover duplicate confirmed bookings, normalized email collisions, invalid grids, negative prices, invalid seat coordinates, and inconsistent cancellation timestamps. Each verifies the original diagnostic in CLI output and Prisma logs, exact rollback of all application rows, absence of partially installed DDL, P3009 on blind retry, explicit reconciliation, metadata-only resolution, successful redeployment, and retained booking history.

Only the dedicated test PostgreSQL service and its generated fixture databases were migrated or written. The application database was not reset, migrated, or written to by verification. No application volumes were removed. The integrity migration remains pending for the application database; applying it requires separate approval.

## Approved follow-up corrections

- The API client captures the outgoing bearer token. A 401 clears authentication only if that same token is still stored; an old request cannot log out a newly signed-in session.
- Registration retains the 12-character minimum and 72 UTF-8 byte maximum. Login passes the original string directly to bcrypt, preserving its legacy truncation semantics, and accepts nonempty passwords within the API's existing 32 KiB request budget. JSON overhead reduces the largest password that fits a request. The login form allows up to 32,768 UTF-16 code units; the server remains authoritative for byte/body limits. No smaller arbitrary login cap or credential rewriting was introduced.
- The migration now uses one PostgreSQL `DO` statement encompassing preflight checks, normalization, constraints, and indexes. PostgreSQL rolls back that statement on error. This preserves atomicity while avoiding Prisma 5's misleading `current transaction is aborted` diagnostic from the former explicit BEGIN/COMMIT batch. Table locks prevent legacy writers from changing the preflight data during installation.

The final review covered tracked and untracked Phase 1 source, tests, migration SQL, dependency changes, Docker configuration, and documentation. No additional blocking regression or unrelated feature change was found. No new hardcoded application signing secret is present; database passwords in Compose are local demo/isolated test credentials. SHA-256 checks confirm that both package manifests and both lockfiles are unchanged from the start of this approved correction pass. All 51 proposed commit paths are accounted for exactly once; only the user's pre-existing server lockfile change is excluded. No staging was performed. The remaining launch and verification limits below still apply.

## Migration diagnostics and recovery

These are operator instructions, **not commands executed against the application database during this work**. This migration scans and locks all four application tables while normalizing emails and installing constraints/indexes. Plan a maintenance window, stop all application writers (including automatic startup retries), take a verified backup, and rehearse on a restored copy. Do not silently select a winning booking, delete history, merge accounts, reset volumes, or use `prisma migrate reset`/`db push` to bypass a failure.

1. Confirm the intended database identity and inspect the original migration error and Prisma state using a trusted database session. Avoid putting real connection secrets in shell history. Useful read-only diagnostics:

   ```sql
   SELECT current_database(), current_user;
   SELECT migration_name, started_at, finished_at, rolled_back_at, logs
   FROM "_prisma_migrations"
   WHERE migration_name = '20261022000000_booking_integrity';

   SELECT "seatId", array_agg(id ORDER BY id) AS booking_ids,
          array_agg("userId" ORDER BY id) AS user_ids
   FROM "Booking" WHERE status = 'CONFIRMED'
   GROUP BY "seatId" HAVING count(*) > 1;

   SELECT lower(btrim(email)) AS normalized_email, array_agg(id ORDER BY id) AS user_ids
   FROM "User" GROUP BY lower(btrim(email)) HAVING count(*) > 1;

   SELECT id, rows, cols, "priceCents" FROM "Event"
   WHERE rows NOT BETWEEN 1 AND 26 OR cols NOT BETWEEN 1 AND 30 OR "priceCents" < 0;
   SELECT id, "eventId", row, col FROM "Seat"
   WHERE row NOT BETWEEN 0 AND 25 OR col NOT BETWEEN 0 AND 29;
   SELECT id, "seatId", "userId", status, "cancelledAt" FROM "Booking"
   WHERE (status = 'CANCELLED') <> ("cancelledAt" IS NOT NULL);
   ```

2. Verify rollback against the backup/rehearsal snapshot and expected schema. A normal SQL error in this single-statement migration leaves application data unchanged and installs none of its indexes or CHECK constraints. For example, inspect `pg_indexes` for `Booking_one_confirmed_per_seat`, `Booking_seatId_status_idx`, `Booking_userId_createdAt_idx`, and `Event_startsAt_idx`; inspect `pg_constraint` for `User_email_normalized`, `Event_grid_bounds`, `Event_price_nonnegative`, `Seat_coordinates_bounds`, and `Booking_cancellation_consistent`. If a connection was interrupted after SQL committed but before Prisma recorded completion, the actual schema may already contain the whole migration: investigate before resolving metadata. `resolve` does **not** undo any SQL.
3. With the data owner's decision recorded, reconcile only the conflicting records in an explicit transaction. For duplicate bookings this may mean deliberately cancelling an agreed duplicate with its timestamp while preserving the row; email collisions require deciding which actual account owns each verified address. Correct invalid grid/price/coordinate/timestamp data from reliable records, preserving IDs, relationships, and history. The synthetic tests demonstrate recovery mechanics, not a production policy for deciding customer ownership. Re-run diagnostics and check the approved data changes before proceeding.
4. **Only after confirming the failed migration rolled back**, run from `server/` with `DATABASE_URL` securely set to the verified intended database:

   ```bash
   npx prisma migrate resolve --rolled-back 20261022000000_booking_integrity
   npx prisma migrate deploy
   npx prisma migrate status
   ```

   `--rolled-back` only reconciles Prisma's failed-migration record; it does not repair data. An unreconciled failed entry blocks deploy with P3009. Do not mark the migration `--applied` to suppress an unresolved failure. If an interruption left the complete migration applied, marking it applied requires independent verification of every data transformation, constraint, and index first; ambiguous or partial states need a reviewed recovery plan.
5. Verify all expected constraints/indexes and the successful Prisma record, compare booking counts/IDs/statuses and account relationships against the approved snapshot, then run login, browse, booking, history, and cancellation smoke checks before resuming service. Never edit an already successfully applied migration; use a new reviewed migration for subsequent changes. The current SQL revision is for the pending, uncommitted Phase 1 migration.

## Dependency review retained from the follow-up audit

No package manifest or lockfile changed while implementing the three approved corrections. The earlier Vite/test-tool changes remain part of the existing Phase 1 diff. The npm counts describe affected package entries, including inherited findings, rather than nine independent vulnerabilities.

| Reported entries | Production dependency? | Reachability and decision |
| --- | --- | --- |
| High: `braces@3.0.3`, inherited through `chokidar`, `fast-glob`, `micromatch`, and `tailwindcss` (5 entries) | Build/watch tools, not client runtime dependencies; still installed in the development images | The reported resource-exhaustion scenario requires hostile glob patterns. Application requests do not supply these patterns. No patched braces release was available in the reviewed metadata; npm's suggested Tailwind 4 upgrade entails a CSS/tooling migration. Track the [upstream report and impact discussion](https://github.com/micromatch/braces/issues/70); do not force an unrelated major upgrade. |
| Moderate: `postcss-selector-parser@6.1.5` and inherited `postcss-nested@6.2.0` (2 entries) | Build tools | The [maintainer advisory](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf) lists 6.1.5 as patched. The installed parser was inspected and contains the Set-based fixes; the lock has only that parser version. npm's affected range over-reports the installed artifact. Record the discrepancy rather than forcing a major upgrade. |
| Moderate: `react-router@6.30.6`, inherited `react-router-dom@6.30.6` (2 entries) | Yes | The [open-redirect advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6) needs an attacker-controlled navigation destination; current destinations are fixed/internal or use validated numeric IDs. The [SSR hydration advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg) does not apply to this app's declarative client rendering. A targeted Router 7 migration is available but requires compatibility review and authorization; it is outside these approved fixes. |

The prior backend production dependency audit reported zero advisories. This is a reachability assessment of the current application, not a claim that the full dependency audit is clean. No advisory scan was rerun for the unchanged dependencies during this correction pass.

## Remaining work and risks

- **Not complete:** holds, countdown, refresh/restart hold recovery, broader browser tests, seed/startup reliability, full clean Compose startup, and final handover/transcript export. These remain in later phases.
- **Dependencies:** the advisory analysis above remains applicable; track reviewed dependency fixes before launch. No additional dependency upgrade was needed for the approved corrections.
- **Operational configuration:** Compose remains a development configuration with known demo credentials and development servers. Loopback publishing limits host exposure but does not make this suitable for deployment. API readiness and atomic/repeatable demo seeding remain to be addressed.
- **Authentication:** bearer tokens remain in browser localStorage and last seven days. This preserves the current architecture; XSS/session policy review remains before launch. The in-memory rate limiter covers one API process and does not trust proxy headers; multiple replicas need shared enforcement or an appropriate edge policy.
- **Migration safety:** populated legacy upgrades, six conflicting/invalid-data failures, rollback, and recovery were verified on synthetic PostgreSQL fixtures. Real customer conflicts still require an operator/data-owner decision. The migration takes blocking table locks; database-size and maintenance-window validation remain before application rollout.
- **Verification limits:** frontend tests use jsdom, not a full browser. Individual images and the isolated test stack were verified; the complete application startup/seed journey from a fresh volume remains Phase 5.

## Genuine AI mistakes recorded

1. I initially reused Vitest 5 for the Vite 5 frontend without checking its peer range. npm rejected it. The older compatible test runner then exposed critical transitive advisories. Package metadata and audit results led to patched Vite 6.4.5 with Vitest 5, followed by fresh Docker installs, tests, and builds. No `--force` bypass was used.
2. I wrote `beforeEach(() => mockedApi.mockReset())`. It returned the mock function, which Vitest treated as a cleanup callback and invoked after tests. Two error-state tests failed even though their UI assertions succeeded. A block-bodied hook returning nothing fixed the harness; all 12 frontend tests then passed. This is a test-code mistake, not a fabricated application defect.

These notes describe actual events; they are not a substitute for exporting the genuine development conversation into `ai-transcripts/` during handover.

## Proposed commits — approval required

No staging or commits have been performed. Keep regression tests with their corresponding implementation. The following four manifests list exact paths, with no wildcard staging. Preserve the user's port **5434** in the Compose commit. Exclude the pre-existing `server/package-lock.json` change from all four commits; leave it untouched in the working tree.

1. Backend security, database integrity, backend regressions, and required development/test configuration:

```text
fix(api): secure identity and seat booking

Reject forged sessions and foreign cancellations. Serialize seat
mutations and enforce one confirmed booking per seat in PostgreSQL.

The migration stops on conflicting legacy bookings or email addresses
instead of deleting records. Verify populated upgrades and recovery.
Preserve legacy bcrypt login inputs. Existing sessions must sign in again.
```

Exact files:

```text
.gitignore
server/.dockerignore
server/.env.example
server/Dockerfile
server/package.json
server/prisma/migrations/20261022000000_booking_integrity/migration.sql
server/prisma/schema.prisma
server/src/app.ts
server/src/config.ts
server/src/http.ts
server/src/index.ts
server/src/middleware/auth.ts
server/src/middleware/authRateLimit.ts
server/src/routes/auth.ts
server/src/routes/bookings.ts
server/src/routes/events.ts
server/src/services/bookingService.ts
server/src/services/eventService.ts
server/src/utils/helpers.ts
server/src/validation.ts
server/test/api.integration.test.ts
server/test/config.test.ts
server/test/helpers.test.ts
server/test/integrationSetup.ts
server/test/migration.integration.test.ts
server/test/rateLimit.test.ts
server/test/validation.test.ts
server/tsconfig.json
server/vitest.config.mts
server/vitest.integration.config.mts
```

2. Frontend request/authentication flows, registration, booking/cancellation corrections, frontend tests, and patched build tooling:

```text
fix(client): handle booking and session failures

Handle rejected requests before reporting success. Scope 401 logout to
the outgoing token so stale responses preserve a replacement session.
Preserve legacy login inputs and organizer signup. Include the previously
reviewed Vite/Vitest compatibility and security updates.
```

Exact files:

```text
client/Dockerfile
client/package-lock.json
client/package.json
client/src/App.tsx
client/src/api.test.ts
client/src/api.ts
client/src/auth.ts
client/src/components/Navbar.tsx
client/src/pages/CreateEventPage.tsx
client/src/pages/EventDetailPage.tsx
client/src/pages/EventsPage.tsx
client/src/pages/LoginPage.tsx
client/src/pages/MyBookingsPage.tsx
client/src/pages/phase1.test.tsx
client/src/test/setup.ts
client/src/types.ts
client/vitest.config.mts
```

3. Local service configuration and isolated test services:

```text
build: isolate development and test services

Bind development ports to loopback and persist the random signing secret.
Preserve PostgreSQL host port 5434. Add disposable PostgreSQL checks that
never attach the application's database volume.
```

Exact files:

```text
docker-compose.yml
docker-compose.test.yml
```

4. Review, migration recovery, and reproduction documentation:

```text
docs: record phase one verification and risks
```

Exact files:

```text
README.md
docs/phase-1.md
```

Apply in this order after approval. Commit 1's integration tests can run with an explicitly supplied disposable TEST_DATABASE_URL; commit 3 supplies the convenient Compose harness for both suites. Never squash or rewrite history.
