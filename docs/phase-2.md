# Phase 2 backend seat holds — 23 October 2026

Backend/database implementation only. The frontend countdown and hold controls remain Phase 3. The application database and Docker volumes are not used for verification. No staging, commits, dependency upgrades, or pushes are part of this phase.

## Storage and migration design

`Booking` now represents a seat reservation throughout its lifecycle. Existing `CONFIRMED` and `CANCELLED` rows keep their IDs, values, and relationships. New states are `HELD`, `EXPIRED`, and `RELEASED`; a nullable `expiresAt` records hold deadlines. Holds retain their ID when confirmed. Existing immediate bookings have a null deadline; confirmed/cancelled reservations originating from a hold retain their original deadline for history. `createdAt` remains the reservation's creation time, including when a hold later becomes a booking.

Two additive migrations follow the unchanged Phase 1 history:

- `20261023000000_hold_states`: extends the PostgreSQL enum. These values must commit before the next migration references them, as required by [PostgreSQL ALTER TYPE](https://www.postgresql.org/docs/16/sql-altertype.html).
- `20261023000001_seat_holds`: one atomic `DO` statement adds the nullable deadline, CHECK constraints, a stronger partial unique index, and an owner/status/deadline query index. It replaces the former confirmed-only index after creating its replacement.

The database enforces:

- At most one row per seat whose status is `HELD` or `CONFIRMED`, through `Booking_one_live_reservation_per_seat`. A direct write cannot create a hold alongside a confirmed booking, or two holds/bookings.
- A hold deadline is exactly `createdAt + interval '10 minutes'` whenever present. `HELD`, `EXPIRED`, and `RELEASED` require a deadline.
- Existing foreign keys, canonical email, grid/price/coordinate checks, and cancellation timestamp consistency remain enforced.

The index deliberately includes expired rows still labelled `HELD`. A changing time condition cannot be used in an index predicate because PostgreSQL requires immutable expressions ([CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html)). Mutation transactions reconcile those rows before acquiring a seat. Availability reads evaluate the timestamp directly and need no cleanup.

Using a separate holds table would need additional cross-table coordination to enforce hold-versus-booking exclusivity at the database boundary. Adding hold columns to `Seat` would split reservation ownership/history across tables. Extending the existing reservation table gives one constraint and one locking order with minimal infrastructure. Terminal hold history is retained; future archival is an operational decision.

## Lifecycle and transaction guarantees

```text
available -> HELD -> CONFIRMED -> CANCELLED -> available
               |          (permanent, ignores former hold deadline)
               +-> RELEASED -> available
               +-> EXPIRED  -> available
```

`available` is derived. A stored `HELD` row is effective only while `expiresAt > databaseTime` and the event has not started. Equality means expired. Confirmation must also occur before event start. A hold is always ten minutes, even if the event starts sooner; the event-start rule can close booking eligibility earlier.

All seat mutations use the existing seat row as their mutex: `SELECT ... FOR UPDATE`, followed by database time and expired-hold reconciliation inside a READ COMMITTED transaction. This serializes holds, immediate bookings, confirmations, releases, and booking cancellations across API processes ([PostgreSQL row locks](https://www.postgresql.org/docs/16/explicit-locking.html)). Transactions keep the Phase 1 bounds: 2-second pool wait, 3-second lock timeout, and 5-second transaction timeout. Lock/transaction failures use the existing safe 503 path; clients can retry.

Hold creation samples UTC PostgreSQL `clock_timestamp()` once in its INSERT, truncates to the same millisecond precision as Prisma timestamps, and computes the deadline in SQL. Caller-supplied user IDs, duration, and timestamps do not control the reservation. Confirmation samples database time again in the UPDATE's strict expiry/event predicates, after lock waits and lookups. Its successful state transition is the acceptance point; a transaction may finish/respond after that point. Requiring a network response or COMMIT to arrive before the deadline would not be a reliable client contract.

Expected business rejections are returned from the transaction and raised after it commits, so an expired hold stays reconciled even when confirmation returns 409. Unexpected database exceptions occur inside the transaction and roll back every change, including reconciliation. The shared unique index independently backs up the locking protocol. Constraint failures do not create partial bookings.

Read endpoints use a consistent REPEATABLE READ snapshot and a database timestamp. Availability is advisory and can change immediately afterward; every mutation rechecks under the seat lock. Public seat responses disclose no hold owner or hold ID. Private `/holds/mine` supplies the current user's recovery state and original expiration after refresh/restart.

## API contracts

All `/holds` endpoints require `Authorization: Bearer <token>` and the current database role `ATTENDEE`. Authentication failures are 401; organizers receive 403. Foreign/missing hold IDs return the same 404 `HOLD_NOT_FOUND`. Numeric IDs must be positive PostgreSQL integers. Malformed JSON/body/IDs return 400; oversized bodies return 413. The existing error envelope remains `{ "error": { "code": "...", "message": "..." } }`.

| Method | Endpoint | Successful behavior |
| --- | --- | --- |
| POST | `/holds` | `{ "seatId": 12 }`; 201 for a new hold, 200 for the same owner's existing active hold |
| GET | `/holds/mine` | 200 `{ "holds": [...], "serverTime": "..." }`; only effective own holds for future events |
| POST | `/holds/:id/confirm` | 200 `{ "booking": {...}, "hold": {...}, "serverTime": "..." }`; same reservation becomes permanent |
| POST | `/holds/:id/release` | 200 `{ "hold": {...}, "serverTime": "..." }`; explicit release, also 200 on repeated release |
| GET | `/events/:id` | Existing public event shape plus database `serverTime` and hold-aware seat fields |
| GET | `/events` | Existing array shape; hold-aware `seatsLeft`, plus `serverTime` on each event |

Create a hold:

```http
POST /holds
Authorization: Bearer <attendee-token>
Content-Type: application/json

{"seatId":12}
```

```json
{
  "hold": {
    "id": 41,
    "seatId": 12,
    "status": "HELD",
    "createdAt": "2026-10-23T12:00:00.000Z",
    "expiresAt": "2026-10-23T12:10:00.000Z"
  },
  "serverTime": "2026-10-23T12:00:00.000Z"
}
```

Repeated POSTs by the same owner return 200 with exactly the same hold object/deadline and a fresh `serverTime`. They never extend the hold. Another user or an existing confirmed booking yields 409 `SEAT_UNAVAILABLE`. After expiration/release, a new POST creates a new ID and ten-minute deadline (201), preserving the terminal prior row.

Recover after refresh or restart:

```http
GET /holds/mine
Authorization: Bearer <attendee-token>
```

```json
{
  "holds": [{
    "id": 41, "seatId": 12, "status": "HELD",
    "createdAt": "2026-10-23T12:00:00.000Z", "expiresAt": "2026-10-23T12:10:00.000Z",
    "seat": { "id": 12, "label": "A1", "row": 0, "col": 0,
      "event": { "id": 3, "title": "Workshop", "venue": "Dhaka", "startsAt": "2026-10-24T12:00:00.000Z" }
    }
  }],
  "serverTime": "2026-10-23T12:02:00.000Z"
}
```

The empty result is `holds: []`. Phase 3 can estimate remaining time from `expiresAt - serverTime`, use a monotonic browser timer, and refetch on focus/reconnect. Browser time never authorizes confirmation.

Confirm:

```http
POST /holds/41/confirm
Authorization: Bearer <attendee-token>
```

```json
{
  "booking": {
    "id": 41, "seatId": 12, "userId": 7, "status": "CONFIRMED",
    "createdAt": "2026-10-23T12:00:00.000Z", "cancelledAt": null,
    "expiresAt": "2026-10-23T12:10:00.000Z"
  },
  "hold": {
    "id": 41, "seatId": 12, "status": "CONFIRMED",
    "createdAt": "2026-10-23T12:00:00.000Z", "expiresAt": "2026-10-23T12:10:00.000Z"
  },
  "serverTime": "2026-10-23T12:03:00.000Z"
}
```

Concurrent/repeated confirmations return the same confirmed booking, including after its former deadline/event start: those retries acknowledge an already completed transition. They do not create another booking. An unconfirmed expired hold returns 409 `HOLD_EXPIRED`; a released or subsequently cancelled reservation returns 409 `HOLD_NOT_ACTIVE`. Neither can be resurrected. An event that starts before initial confirmation returns 409 `EVENT_STARTED`.

Release:

```http
POST /holds/41/release
Authorization: Bearer <attendee-token>
```

The hold envelope returns `status: "RELEASED"` with the original timestamps and current `serverTime`. Repeating release succeeds without affecting a replacement reservation. Expired holds return 409 `HOLD_EXPIRED`; confirmed/cancelled holds return 409 `HOLD_NOT_ACTIVE`. To cancel a confirmed booking, use the existing owner-scoped booking cancellation endpoint.

An event detail seat now looks like:

```json
{"id":12,"row":0,"col":0,"label":"A1","available":false,"status":"HELD","holdExpiresAt":"2026-10-23T12:10:00.000Z"}
```

Possible public statuses: `AVAILABLE`, `HELD`, `BOOKED`, `CLOSED`. Only `AVAILABLE` has `available: true`. `holdExpiresAt` is null except for an effective hold. Expired holds appear available immediately without a worker; past events are always closed.

## Compatibility and assumptions

- Existing `POST /bookings` still immediately books an unheld available seat. It rejects any active hold, including the caller's own, with 409 `SEAT_UNAVAILABLE`; an owner must explicitly use the hold confirmation endpoint. This preserves the existing UI until Phase 3 while closing the hold bypass.
- `/bookings/mine` contains only confirmed/cancelled bookings; abandoned/released/expired holds do not pollute booking history. A hold cannot be cancelled through `/bookings/:id/cancel` (404). Confirmed holds use that endpoint normally, with the existing idempotency/history guarantees.
- A user may hold multiple seats; no new per-user quota, anti-hoarding policy, payments, notifications, Redis, cron, or worker was introduced. Expired rows may keep their stored `HELD` label until that seat is next mutated. Their effective availability is always timestamp-based.
- Existing authentication/session/storage and process-local rate limiting remain Phase 1 behavior. Full clean application startup/seed reliability, large-database lock impact, abuse limits, and launch hardening remain later work. Rolling mixed-version application deployment is unsupported: drain old writers, apply migrations, then start the new backend. The new index prevents old code from stealing holds, but old versions cannot correctly report hold availability/history.
- Do not apply these migrations to the application database without separate approval. They preserve existing booking rows and the earlier migration files. The enum-only migration may already have committed if the following DDL migration fails; harmless unused enum labels are not a reason to reset data. Use the [reviewed reconciliation/Prisma recovery procedure](phase-1.md#migration-diagnostics-and-recovery), inspect actual schema state, and resolve only the failed migration name after verifying rollback. Never edit an applied migration or mark missing DDL applied to bypass an error.

## Verification and changed files

Executed on 23 October 2026 in Node 24 containers against the dedicated PostgreSQL 16 test service:

| Check | Actual result |
| --- | --- |
| Backend Docker image build and Prisma client generation | Passed, locked dependencies reused |
| `prisma validate` | Passed |
| Backend `npm run typecheck` | Passed, including all tests |
| Backend `npm test` | 53 passed across 4 files |
| Backend `npm run test:integration` | 68 passed across 3 files: 28 original API, 32 hold, 8 populated migration/recovery tests |
| `prisma migrate status` on the isolated test database | All 4 migrations applied; schema up to date |
| Existing frontend tests, without source changes | 16 passed across 2 files |
| Existing frontend production build | TypeScript and Vite build passed |
| `git diff --check` | Passed |

The final Vitest JSON reports counted 121 backend assertions plus 16 existing frontend assertions. Every assertion was `passed`; no failures, skipped assertions, pending tests, or todo tests. The original twelve-request booking regression remains passing and still checks the winning response against database state.

The hold regressions include exact SQL-persisted ten-minute duration; expiry availability at -1/0/+1 milliseconds in pure unit tests; backdated synthetic timestamps using database time; expired confirmation rejection and committed reconciliation; fresh and expired-seat twelve-attendee races; twelve confirmations returning one booking; concurrent same-user acquisition/release retries; hold-versus-immediate-booking races; direct independent-client database uniqueness; confirmation-versus-release races; a request that becomes expired while demonstrably waiting on a seat lock; database constraint failures and rollback/retry; authorization/input bounds; and two actual API subprocesses recovering both an active original deadline and an expired seat after restart. No production clock override or long sleep was introduced. A new populated Phase 1 upgrade test preserves all original booking values and earlier `_prisma_migrations` records.

The first typecheck caught a missing closing template delimiter in the new lock-wait test. It was corrected before the passing runs. This was a test-source syntax error; no test was skipped or weakened to obtain the results.

Reproduce from the repository root:

```bash
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm server-tests
docker compose -p seatbook-phase1-tests -f docker-compose.test.yml run --build --rm client-tests
```

The existing test project name is retained intentionally; it still uses only its dedicated credentials, network, port 55435 and temporary PostgreSQL storage. Migration tests create/drop generated fixture databases only within that instance. Full application Compose startup/seed smoke testing is still Phase 5 and was not run against the application's existing database. Frontend tests are jsdom tests with mocked API calls; the real backend HTTP contracts are exercised separately by PostgreSQL integration tests. No browser hold UI is claimed.

Final review found no unrelated source changes or additional blocking defect. The existing server lockfile's SHA-256 remains `629074cd481aa0472032718c69d39c9e14ce5074034c811d315e291358658606`. Both package manifests and both lockfiles are unchanged from Phase 2 entry. Earlier migration files, client source, application Compose configuration/port 5434, and Git history remain unchanged. No application database migrations, volume operations, staging, commits, or pushes were performed.

Exact Phase 2 file inventory, grouped into three suggested incremental commits (approval required):

1. `feat(db): add persistent seat hold states` — additive schema/index constraints and populated migration regression. Deploy enum additions before the atomic constraint/index migration; preserve existing rows and earlier migration records. Four files:

   ```text
   server/prisma/schema.prisma
   server/prisma/migrations/20261023000000_hold_states/migration.sql
   server/prisma/migrations/20261023000001_seat_holds/migration.sql
   server/test/migration.integration.test.ts
   ```

2. `feat(api): add transactional seat holds` — authenticated hold lifecycle, shared seat locking, expiry reconciliation, compatible immediate booking/cancellation, database-time availability, safe raw SQL conflicts, and the matching regressions. Thirteen files:

   ```text
   server/src/app.ts
   server/src/http.ts
   server/src/routes/bookings.ts
   server/src/routes/events.ts
   server/src/routes/holds.ts
   server/src/services/bookingService.ts
   server/src/services/eventService.ts
   server/src/services/holdService.ts
   server/src/services/seatTransaction.ts
   server/src/utils/helpers.ts
   server/test/api.integration.test.ts
   server/test/helpers.test.ts
   server/test/holds.integration.test.ts
   ```

3. `docs: explain backend hold contracts and checks` — contracts, examples, assumptions, migration trade-offs, actual verification, inventory, and remaining risks. Two files:

   ```text
   README.md
   docs/phase-2.md
   ```

These are 19 Phase 2 paths, each assigned once. The pre-existing `server/package-lock.json` modification is excluded and must remain untouched/uncommitted. Suggested order is 1 → 2 → 3; the API commit depends on the schema commit and includes its regression tests. No commits will be created without review approval.
