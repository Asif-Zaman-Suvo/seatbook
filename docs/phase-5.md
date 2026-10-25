# Phase 5 — clean startup and real full-stack verification

Verification took place on 23–24 October 2026, Bangladesh time (UTC+06:00). Phase 5 is ready for final review. No staging, commits, pushes, dependency upgrades, application-database migrations, or Phase 6 work were performed.

## Scope and implementation

The original assignment requires a clean Docker start and working organizer/attendee flows with exclusive ten-minute holds. This phase changes only readiness behavior, Compose startup ordering, isolated verification configuration, and focused readiness tests.

- `/health` remains process liveness, returning `200 { "ok": true }` independently of PostgreSQL.
- New public `GET /ready` checks access to the four core tables using `SELECT 1 FROM "User", "Event", "Seat", "Booking" LIMIT 0`. It reads no customer records. Success returns `200 { "ok": true }`; failure returns `503 { "error": { "code": "SERVICE_UNAVAILABLE", "message": "Service temporarily unavailable. Please retry." } }`. Responses retain the existing no-store/security headers and expose no SQL diagnostics or credentials.
- The server's Compose healthcheck calls `/ready` using Node's built-in fetch. Its interval is two seconds, timeout three seconds, start period thirty seconds, and retry count fifteen.
- The client now depends on server `service_healthy`. PostgreSQL's existing health dependency and the server's generate → migrate → seed → start command remain intact.
- `docker-compose.verify.yml` overrides only verification credentials, ports, origins, and mounts. It removes development source bind mounts so verification uses files copied into the actual images. It requires Compose 2.24.4+ for `!override`; the base workflow does not depend on this override file.

No application business rules, frontend source, database schema, migrations, seed implementation, package versions, or Dockerfiles changed in this phase.

## Isolation and resource preservation

Four separate Phase 5 projects were used:

| Project | Purpose | Storage / published ports |
|---|---|---|
| `seatbook-phase5-verify` | Initial startup and ordering reproduction | Its own named volumes; 15435 / 14000 / 15173 |
| `seatbook-phase5-clean` | Corrected readiness and real Chrome-to-API-to-PostgreSQL flows | Its own named volumes; 15435 / 14000 / 15173 |
| `seatbook-phase5-tests` | Automated unit, frontend, and integration suites | PostgreSQL tmpfs, no application volume bindings; loopback 55435 |
| `seatbook-phase5-final` | Final corrected startup with completely fresh persistent storage | New named volumes; 25435 / 24000 / 25173 |

The initial verification project's containers/network were removed only after inspecting their project labels and mounts, without `-v`; its volumes were retained. The later clean, automated-test, and final projects remain available. No volumes were deleted, reset, or pruned.

Before the final start, the final project had no containers, network, or volumes, and `lsof` found no listeners on its three ports. The fully merged configuration was inspected using all three files:

```bash
docker compose -p seatbook-phase5-final \
  -f docker-compose.yml \
  -f docker-compose.verify.yml \
  -f /tmp/seatbook-phase5.jtk1Jm/fresh-ports.yml config --format json
```

The final port override used for this run was:

```yaml
services:
  db:
    ports: !override
      - "127.0.0.1:25435:5432"
  server:
    environment:
      CLIENT_ORIGIN: http://localhost:25173
    ports: !override
      - "127.0.0.1:24000:4000"
  client:
    environment:
      VITE_API_URL: http://localhost:24000
    ports: !override
      - "127.0.0.1:25173:5173"
```

All final containers are `seatbook-phase5-final-{db,server,client}-1` on `seatbook-phase5-final_default`. PostgreSQL mounts only `seatbook-phase5-final_db-data`; the server mounts only `seatbook-phase5-final_api-config`; the client mounts no volumes. All have the final project's labels. There are no source bind mounts, external volumes, or fixed `container_name` settings. The database/user is `seatbook_phase5`; API and client origins use only the final ports.

Post-run inspection confirmed the original application and browser-test container IDs were preserved, and all eighteen volume names from the pre-final-start inventory remained present. No commands stopped, restarted, or recreated the existing application containers, and no SQL queries or tests targeted its database during this final verification. Existing containers were inspected only for preservation checks. Base PostgreSQL port **5434** remains unchanged.

## Final fresh-start evidence

The final startup completed successfully:

```bash
docker compose -p seatbook-phase5-final \
  -f docker-compose.yml \
  -f docker-compose.verify.yml \
  -f /tmp/seatbook-phase5.jtk1Jm/fresh-ports.yml up --build -d --wait
```

The log records creation of the final project's network, both fresh volumes, and all three containers. Docker build cache was reused; this proves fresh database/configuration initialization, not an uncached or offline dependency installation. The first Phase 5 build also completed a locked `npm ci` in the server image; no package files were changed.

Read-only SQL confirmed all four migrations completed, with no rollback markers:

1. `20261001000000_init`
2. `20261022000000_booking_integrity`
3. `20261023000000_hold_states`
4. `20261023000001_seat_holds`

The fresh database contains exactly **3 users, 3 events, 79 seats, and 4 bookings**. Accounts are `organizer@seatbook.test` (ORGANIZER), `alice@seatbook.test` and `bob@seatbook.test` (ATTENDEE).

Final service logs, converted from their UTC timestamps to Bangladesh time on 23 October:

| Milestone | Bangladesh time |
|---|---|
| All migrations successfully applied | 23:41:51.019 |
| Seed completed | 23:41:51.428 |
| API listening | 23:41:51.874 |
| Vite ready | 23:41:55.202 |

Compose's startup log shows database healthy → server started → server healthy → client started. Subsequent HTTP checks confirmed `/health`, `/ready`, and `/events` returned 200; event discovery returned three seeded events. The frontend on 25173 returned 200 and its served API module uses port 24000. CORS returned the correct isolated frontend origin. PostgreSQL and API have healthy status; the frontend is running and HTTP-verified, with no independent client healthcheck.

### Exact standard command versus isolated verification

The required standard workflow remains `docker compose up --build`. The base configuration parses successfully with `docker compose config --quiet`, retains ports 5434/4000/5173, and uses the same Dockerfiles, startup chain, database health dependency, and corrected server/client readiness ordering exercised above. Its normal development source bind paths exist in this repository.

**The exact unqualified `docker compose up --build` command was not executed against the existing application project.** Those ports and resources are already in use, and doing so could recreate containers or apply migrations to the protected application database. The executed evidence is the explicitly isolated, merged configuration above; it does not claim that the existing application database was upgraded or that base development bind mounts were exercised by the isolated run. On an otherwise clean machine with the standard ports available, no override file or extra startup command is required by the base configuration.

## Real browser verification — 17 passed, zero failed

Chrome ran the actual Vite frontend against the isolated Express API and PostgreSQL in `seatbook-phase5-clean`. Network responses were not mocked or fulfilled by fixtures. Positive user flows used the application UI; negative/idempotency/concurrency checks also issued real fetch requests from the authenticated browser contexts. SQL assertions inspected persisted state.

| Check | Result |
|---|---|
| Demo accounts present | Passed |
| Organizer signup, logout, login | Passed |
| Organizer creates an event with a 2×6 grid and 1995-cent price | Passed |
| Attendee signup, logout, login | Passed |
| Discovery, seat selection, exact 600,000 ms hold interval and advancing countdown | Passed |
| Repeated hold request retains original deadline | Passed |
| Other attendee sees HELD, cannot hold/book or modify owner's hold, and receives no private identity | Passed |
| Navigation and refresh restore the same active hold/deadline | Passed |
| Confirmation, confirmation retry, booking history, cancellation and availability | Passed |
| Release allows immediate acquisition by another attendee | Passed |
| Expiry updates UI, rejects confirmation and allows reacquisition | Passed |
| Competing browser requests produce one hold winner and one persisted confirmed booking | Passed |
| 375px hold layout fits; browser Date.now change does not extend the displayed countdown | Passed |
| API restart preserves authenticated hold, dates, credentials and bookings | Passed |
| Full browser close/reopen restores the authenticated hold/deadline | Passed |
| Actual PostgreSQL outage makes readiness 503; recovery returns 200 and preserves hold | Passed |
| No browser JavaScript exceptions | Passed |

For deterministic expiry, the harness updates only the newly created A3 hold's primary-key row while it is HELD, setting both timestamps together from database time so the ten-minute interval constraint is preserved and four seconds remain. It verifies exactly one updated row. It does not change the application clock or any production expiration rule, and it does not wait ten minutes. Before SQL mutation or service interruption, guards verify the project, mounted volume names, and database/user. Restart/stop/start commands have an explicit `-p seatbook-phase5-clean`; the PostgreSQL start is the paired recovery in a `finally` block. No reset, DROP, DELETE, prune, or volume removal is in this browser harness.

The API restart uses the existing test configuration-secret volume, verifying that the previous browser token remains usable. PostgreSQL outage verification stops/starts only the isolated database. Runtime Compose health does not automatically restart services or stop the already running frontend; `depends_on` health ordering applies at startup.

## Automated verification

Executed in isolated Docker test containers with the current schema's generated Prisma client:

| Suite | Passed | Failed | Skipped/pending/todo |
|---|---:|---:|---:|
| Frontend, six files | 79 | 0 | 0 |
| Backend unit, four files | 53 | 0 | 0 |
| PostgreSQL integration, four files | 80 | 0 | 0 |
| **Total** | **212** | **0** | **0** |

The integration count is 31 API, 33 hold, eight migration, and eight seed tests. The two new API cases cover readiness success with migrated tables and safe failure/recovery independently of liveness. The permanent failure-response case simulates a Prisma rejection; the separate browser outage case uses the actual stopped PostgreSQL service. The existing twelve-contender acquisition and confirmation regressions remain included.

Both TypeScript checks and the frontend production build passed in Docker. Vite built 43 modules (20.41 kB CSS, 205.62 kB JavaScript). Vitest JSON reports show every assertion passed, without skipped suites, pending tests, or todo cases. `git diff --check` also passed. Existing React Router future-flag warnings are informational; no dependency changes were made to suppress them.

The initial host-only backend typecheck failed because its previously generated Prisma client lacked the hold states/columns. Docker generates the client from the current schema before checks; its complete backend TypeScript check passed. No host dependencies, generated clients, databases, or package versions were changed to hide that discrepancy.

## Bugs found and corrections

- **Startup ordering:** The initial isolated run had Vite ready at 21:40:26.157 Bangladesh time while the API listened at 21:40:28.318. Client `service_started` dependency allowed requests before migrations/seed/API readiness. The server readiness probe and client health dependency correct this path, demonstrated by the final fresh run.
- **Liveness mistaken for readiness:** `/health` returned unconditional success. It remains a compatible liveness endpoint; `/ready` now checks core database access and returns a safe 503, including during the tested real database outage.
- **Actual AI implementation error:** The first readiness change called `asyncHandler` without importing it. The isolated API failed with `ReferenceError`, and the health dependency correctly prevented client startup. The import was corrected; Docker TypeScript, readiness tests, and the final fresh run passed afterward. No claim is made that the initially failing run succeeded.
- **Browser harness errors:** An initial selector expression had incorrect quoting, and the next event-URL regex lost escaping when evaluated as a JavaScript string. These were harness failures, not application failures. The corrected URL check avoids regex embedding; countdown assertions now compare numeric seconds (`10:00` = 600, `9:59` = 599). The complete corrected harness then passed all seventeen checks.

No additional application defect was discovered in the completed real flows. No hold or authorization contract changes were necessary.

## Evidence and reproduction

Local artifacts are in `/tmp/seatbook-phase5.jtk1Jm/` and are not committed or assumed to be portable submission artifacts:

- `baseline-startup.log`, `final-clean-start.log`, `final-service-logs.log`, `final-http.json`.
- `client.json`, `unit.json`, `integration.json`, `browser-results.json`.
- `browser.cjs` and screenshots of desktop hold, booking history, mobile hold, and recovered hold.

Earlier harness failure output remains separately identifiable; only the complete passing report is used for the seventeen-check result. Submission evidence/transcript packaging remains Phase 6.

For a repeat on a free machine, use a new project name and inspect merged configuration, resource absence, and port availability first. The repository's verification override defaults to 15435/14000/15173; use a port override like the one above when those belong to an existing verification stack. Never substitute the application project's name or attach its volumes. No cleanup command was run against existing resources during final verification, and no volumes were removed. The final stack remains available at `http://localhost:25173` for review.

Automated suites can be reproduced with the existing separate `docker-compose.test.yml`, an explicit test project name, and inspection of tmpfs/no application bindings and `seatbook_test` identity before integration fixtures. Test images execute TypeScript checking, all suites, and the frontend build; the recorded runs added JSON reporters mounted only into the temporary artifact directory.

## Remaining limitations and launch considerations

- Exact standard-command execution against the existing application's ports/database remains intentionally unperformed; the isolated equivalent is the executed clean-start proof. A fresh-machine standard-command check would provide additional confidence in default bind-mount behavior.
- Browser verification is headless Chrome, with 375px emulation. Safari/Firefox, physical mobile devices, screen-reader testing, long machine sleep/resume, and a natural ten-minute browser wait were not added. The browser clock check changes Date.now, not the operating system clock.
- Real browser verification used development Vite serving; the production frontend bundle was built successfully but was not deployed or tested behind production hosting.
- Readiness checks core table access, not every column, constraint, migration checksum, or write path. Startup migration deployment and the integration suites provide those separate checks. Database/network failures can take Prisma's connection/pool timeout to resolve; the Docker health probe has its own three-second timeout.
- Known public demo credentials, public organizer registration, localStorage token policy, per-process rate limiting, hold-abuse limits, dependency advisories, and broader operational/security considerations remain as recorded in earlier phases. This is the assignment's local development configuration, not deployment infrastructure.
- Already populated legacy partial demo data still requires reviewed reconciliation. Seeding preserves existing data and does not repair it automatically.
- Final README handover, AI transcript packaging, submission access, and the code walkthrough remain Phase 6; they have not been performed here.

## Exact changed files and proposed incremental commits

Five files, assigned once, with no package, lockfile, generated artifact, secret, or migration included:

1. `fix(api): report database readiness`
   - `server/src/app.ts`
   - `server/test/api.integration.test.ts`
2. `build: wait for API readiness before client`
   - `docker-compose.yml`
   - `docker-compose.verify.yml`
3. `docs: record clean-start and full-stack checks`
   - `docs/phase-5.md`

The existing lockfile was preserved as found at Phase 5 entry: SHA-256 `b49d6bb4f3949919f1dc9c8af4ba5e31af88baf6a633d7ee691bd1fac296470f`. Git reported a clean lockfile at that entry (unlike the earlier phase's recorded unstaged state); this phase did not restore, stage, or modify it. Both manifests and both lockfiles retain their Phase 5 entry hashes. The only base Compose changes are readiness healthcheck and client dependency ordering; PostgreSQL host port 5434 is preserved.

Final review checks the entire five-file inventory, error-response privacy, readiness/transaction separation, resolved isolation, startup ordering, no unrelated source/dependency/schema changes, and an empty Git index. Approval is required before any commits or Phase 6 work.

## Final verification and cleanup addendum — 25 October 2026

The sections above preserve the original 23–24 October verification checkpoint, including its then-outstanding handover and exact-command checks. This addendum records their later completion; the original test reports and transcript export are unchanged.

### Exact base Compose startup

An independent temporary checkout at commit `83ce32481a7b623b0359ef67ad120118c18f4e5d` successfully ran the literal command:

```bash
docker compose up --build
```

Only the base Compose file was used, with no command-line flags, override files, or port changes. The dedicated shell supplied `COMPOSE_PROJECT_NAME=seatbook-final-exact-20261025`. Its source bind mounts pointed into the temporary checkout, and its new database/configuration volumes and network belonged exclusively to that project. The existing application database and resources were not used.

| Acceptance check | Recorded result |
|---|---|
| Standard published ports | PostgreSQL 5434, API 4000, frontend 5173 |
| Migrations | All four completed, with no rollback markers |
| Initial seed, before browser mutations | 3 users, 3 events, 79 seats, 4 bookings |
| Readiness and HTTP | PostgreSQL/API healthy; `/health`, `/ready`, `/events`, and frontend returned 200 |
| Real Chrome verification | 17 passed, zero failed, zero recorded JavaScript exceptions |

The browser run used the actual frontend, API, and PostgreSQL. It covered seeded-account login, organizer/attendee signup and login, event creation, seat discovery, exclusive holds, ownership/conflict rejection, unchanged deadlines, confirmation/history/cancellation, release/reacquisition, expiry, concurrent requests, 375px layout, navigation/refresh/reopening recovery, and API restart recovery.

This was a separate seventeen-check run, not a replacement for or addition to the count of unique checks in the earlier Phase 5 report. The real PostgreSQL outage scenario was verified in the earlier run and was not repeated here. The previously completed **212 automated tests were not rerun** during the exact-command verification. Build cache was reused, expiry used an isolated timestamp fixture preserving the ten-minute interval, and frontend serving used development Vite. This verifies clean local startup and real application flows, not production deployment or an uncached/offline build.

### Evidence preservation and isolated cleanup

Execution proof, migration/seed results, browser results, startup/service logs, screenshots, and before/after resource inventories were preserved in a private archive outside the repository and temporary checkout. All fifteen selected evidence files passed SHA-256 verification; the archive directory is mode 0700 and its files are mode 0600. Authenticated browser profiles, the credential-bearing harness, and rendered environment configuration were excluded. The private archive is intentionally not published or copied into this repository.

After identity checks and an approved terminal Ctrl+C shutdown, only the three recorded verification containers, their recorded network, and their two newly created volumes were removed. Post-removal inspection confirmed all six targets were absent and all original **22 containers, 11 networks, and 20 volumes** remained preserved. No global prune, image/build-cache removal, application-database reset, or temporary-checkout deletion occurred. Archive hashes remained valid, and cleanup action/inventory/summary records were preserved privately.

The final README handover and authentic transcript packaging/review/commit are complete. Public GitHub access and remote `main` matching commit `83ce324` were verified without authentication. Approval and publication of this documentation update, and submission through the supplied form, remain; form completion has not been verified. The original phase notes above remain historical evidence, not the current submission checklist.
