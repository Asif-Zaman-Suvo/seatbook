# AI development evidence

Genuine Codex conversations for the Seatbook take-home, exported from one Seatbook-specific local session. This package is **filtered and redacted**, not a complete untouched raw transcript. No conversation has been reconstructed, paraphrased, or written retrospectively as an original message.

## Start here

- [Readable conversation](conversations/seatbook-development.redacted.md) — original visible messages, tool calls, and outputs, in source order, with record anchors.
- [JSONL conversation](conversations/seatbook-development.redacted.jsonl) — the same records with original timestamps and source-line references for machine inspection.
- [Phase 5 verification reports](#verification-reports) — genuine saved test/browser reports; supporting evidence, not substitutes for conversation history.

## Provenance and export boundary

- Source file: `rollout-2026-10-22T18-03-16-01a1637e-7e9e-7fb3-b43c-58aa54b87429.jsonl`.
- Source thread: `01a1637e-7e9e-7fb3-b43c-58aa54b87429`; repository: Seatbook.
- Original location: `[REDACTED: home]/.codex/sessions/2026/10/22/`; the original stays outside this repository and was not edited.
- Included source prefix: lines 1–2790, 13,781,084 bytes; SHA-256 `29bce0ce5261a41cd0bce629b92f1227d1f6a1cdaab2c72164d7075f649decb9`. This fingerprints the exact original prefix, not a later, growing version of the active log.
- Retained activity: `2026-10-22T12:03:19.831Z` through `2026-10-24T20:07:12.764Z` (22–25 October 2026, Bangladesh time). UTC timestamps are copied without conversion.
- The cutoff is the completed README commit report, before the transcript-packaging audit and this packaging run. Those later discussions are intentionally outside this snapshot.
- The exporter read only this session and the four named verification reports. It did not export other projects, Codex authentication files, SQLite databases, environment files, or browser profiles.

## Evidence navigation

These labels are an index, not additional conversation text. Read neighbouring records for the request, implementation, failure, correction, and verification context.

| Subject | Original record |
|---|---|
| Initial security/correctness audit and implementation plan | [Record 000030](conversations/seatbook-development.redacted.md#record-000030) · source line 89 |
| Phase 1 implementation authorization | [Record 000034](conversations/seatbook-development.redacted.md#record-000034) · source line 103 |
| Genuine AI mistake: npm dependency-resolution failure | [Record 000095](conversations/seatbook-development.redacted.md#record-000095) · source line 286 |
| Compatibility correction / Vite 6.4.5 work | [Record 000116](conversations/seatbook-development.redacted.md#record-000116) · source line 342 |
| Genuine test-hook mistake correction | [Record 000145](conversations/seatbook-development.redacted.md#record-000145) · source line 420 |
| Backend hold implementation authorization | [Record 000295](conversations/seatbook-development.redacted.md#record-000295) · source line 865 |
| Persistent hold schema patch | [Record 000304](conversations/seatbook-development.redacted.md#record-000304) · source line 898 |
| Transactional backend hold service patch | [Record 000306](conversations/seatbook-development.redacted.md#record-000306) · source line 905 |
| Frontend hold implementation authorization | [Record 000400](conversations/seatbook-development.redacted.md#record-000400) · source line 1186 |
| Frontend hold coordinator/countdown implementation | [Record 000409](conversations/seatbook-development.redacted.md#record-000409) · source line 1228 |
| Attendee hold controls | [Record 000411](conversations/seatbook-development.redacted.md#record-000411) · source line 1236 |
| Session-isolation and mobile correction request | [Record 000510](conversations/seatbook-development.redacted.md#record-000510) · source line 1535 |
| Phase 4 seed/reliability work authorization | [Record 000590](conversations/seatbook-development.redacted.md#record-000590) · source line 1760 |
| Additional PostgreSQL reliability regression tests | [Record 000611](conversations/seatbook-development.redacted.md#record-000611) · source line 1831 |
| Real full-stack / clean-start verification authorization | [Record 000688](conversations/seatbook-development.redacted.md#record-000688) · source line 2051 |
| Readiness implementation | [Record 000713](conversations/seatbook-development.redacted.md#record-000713) · source line 2114 |
| Genuine AI mistake: missing asyncHandler import fails at runtime | [Record 000749](conversations/seatbook-development.redacted.md#record-000749) · source line 2205 |
| Acknowledgement of readiness mistake | [Record 000750](conversations/seatbook-development.redacted.md#record-000750) · source line 2209 |
| Missing-import correction | [Record 000751](conversations/seatbook-development.redacted.md#record-000751) · source line 2210 |
| Final Phase 5 verification/documentation work | [Record 000842](conversations/seatbook-development.redacted.md#record-000842) · source line 2456 |
| Final Phase 5 review/commit report | [Record 000873](conversations/seatbook-development.redacted.md#record-000873) · source line 2537 |
| Final README handover and commit report | [Record 000952](conversations/seatbook-development.redacted.md#record-000952) · source line 2790 |

## Retention and exclusions

Of **2,790 original records within the fixed prefix**, **952** are retained and **1,838** are excluded. Excluded categories are explicit below; nothing after the cutoff is included in these counts. All visible user/assistant message records and all tool-call/output records in this prefix are retained. Duplicate `event_msg` representations are omitted rather than counting the same exchange twice. Five auto-injected environment/open-page context records are excluded; these are not user-authored conversation messages.

| Retained type | Records |
|---|---:|
| `message:user` | 30 |
| `message:assistant` | 130 |
| `custom_tool_call` | 337 |
| `custom_tool_call_output` | 337 |
| `function_call` | 59 |
| `function_call_output` | 59 |

| Excluded type | Records |
|---|---:|
| `session_meta` | 26 |
| `event_msg` | 762 |
| `message:developer` | 12 |
| `message:user:auto-injected-context` | 5 |
| `world_state` | 9 |
| `turn_context` | 30 |
| `token_usage_record` | 428 |
| `response_item:reasoning` | 562 |
| `compacted` | 4 |

Each of the **396 tool calls has its original output** later in the export. Metadata is allowlisted: original record type, message/tool ID, role, tool name, status, call ID, and visible content are preserved where present. The exporter adds only `record` and `sourceLine` references. Internal metadata fields, developer/system messages, private reasoning, encrypted content, context snapshots, usage data, and generated compaction summaries are excluded.

## Redaction policy

Redactions are literal `[REDACTED: category]` markers. They cover credential literals and database user/password pairs, bcrypt hashes, email addresses, local usernames, and absolute home-directory prefixes. All email addresses, including public/demo/fixture addresses, are redacted consistently instead of guessing which are personal. Credential values in patches, nested JSON strings, configuration snippets, and command output are included in the review. Seven inline base64 image payloads in tool results are replaced by `[REDACTED: embedded-image]` to avoid publishing unreviewed image contents and duplicating large screenshots. Their surrounding tool results remain in place. Original surrounding text is retained; redacted code/commands are evidence, not runnable instructions.

| Redaction pass | Replacements |
|---|---:|
| `bcrypt-hash` | 1 |
| `bearer-token` | 28 |
| `credential-literal` | 203 |
| `database-credentials` | 79 |
| `email` | 304 |
| `embedded-image` | 7 |
| `environment-credential` | 68 |
| `home-path` | 466 |
| `local-user` | 53 |
| `scoped-credential` | 77 |

Counts describe replacement passes across the JSONL source records and the four reports once; they are not counts of unique secrets, and a string can receive multiple passes. The Markdown mirrors the JSONL and is not counted again. No unredacted-value mapping is stored here.

The review also checks token/JWT/API-key patterns, private keys, cookies, session secrets, and embedded images. Pattern scanning is not a mathematical guarantee that a secret cannot remain; a final human review before publication is still recommended. The original full log and browser profiles must remain private.

## Verification reports

These reports were produced during Phase 5, not regenerated during packaging. Numeric results, test names, statuses, timings, and browser request status history are preserved except where a string needs an explicit privacy redaction. Every included report was parsed and scanned.

| Report | Recorded result |
|---|---|
| [Frontend](verification/phase-5/client.json) | 79 passed, 0 failed/pending/todo |
| [Backend unit](verification/phase-5/unit.json) | 53 passed, 0 failed/pending/todo |
| [PostgreSQL integration](verification/phase-5/integration.json) | 80 passed, 0 failed/pending/todo |
| [Real Chrome checks](verification/phase-5/browser-results.json) | 17 passed, 0 failed, no recorded JavaScript errors |

**212 automated tests** and **17 separate browser checks** are represented. Frontend unit tests use mocked APIs; Phase 5 browser checks use the actual frontend, API, and PostgreSQL. Expiry checks use isolated timestamp fixtures, not a natural ten-minute sleep. The reports are supporting snapshots, not a portable committed browser harness or measured coverage percentage.

Successful fresh startup used isolated Compose overrides. Execution of the exact unqualified `docker compose up --build` against a fresh standard environment remains pending; packaging does not perform that verification. See [Phase 5](../docs/phase-5.md).

## Integrity and limits

- JSONL parsing, timestamp ordering, record/role metadata preservation, call/output pairing, Markdown fences/anchors, local evidence links, redaction checks, and report results were validated.
- The 30 user-message and 130 assistant-message event notifications each have their original message counterpart in the retained records; no visible event-only message was dropped.
- The two conversation files contain the same retained records. JSONL is for inspection; Markdown provides navigation. Their duplication is deliberate; duplicate event records and unrelated internal data are excluded.
- The source log may already contain truncated tool output. The export preserves that output as recorded and does not reconstruct missing text. It does not claim to capture AI tools or conversations outside the identified session.
- Original whitespace inside fenced transcript content is preserved, including historical trailing spaces; prose outside those blocks is checked separately.
- No screenshots are claimed as conversation exports. Application screenshots, raw service logs, browser profiles, and database files are intentionally not included.
- Detailed implementation evidence remains in [Phase 1](../docs/phase-1.md), [Phase 2](../docs/phase-2.md), [Phase 3](../docs/phase-3.md), [Phase 4](../docs/phase-4.md), and [Phase 5](../docs/phase-5.md).

### Original verification file fingerprints

These identify the private original input files before export/redaction.

| Original filename | SHA-256 |
|---|---|
| `client.json` | `53667a254f8fea3a6d63c9921cba3aa0f0f8fe83f2e4d3d16b146cc6128c22e3` |
| `unit.json` | `3a4a0f13d12ebf220de7fd0b8d5dc4f80db1eb57f68643202e2ee97df8f28ab9` |
| `integration.json` | `c912d8e53083e3099729b39299c889cd7a15216abe9e39bf078ad5a87c1a3d54` |
| `browser-results.json` | `8f5a1d77c2544b5fb51d99b3098a7ea2e2a84667096151b89afea4a661efa741` |

### Exported file inventory

| File | Bytes | SHA-256 |
|---|---:|---|
| `conversations/seatbook-development.redacted.jsonl` | 4,524,030 | `aad4cc41a263679436479b2e61bf67e6390e791d9f27256cad4bd5a7c35beef7` |
| `conversations/seatbook-development.redacted.md` | 4,547,794 | `63d6600a7a89bbc1817c93bd3389d3ef7add50145a788abc8c48a2f39eec7f21` |
| `verification/phase-5/client.json` | 33,974 | `0d6473f2a2ae4e8dfc2d154823409df62388ee7647b26f78c7ee966bd9264ffd` |
| `verification/phase-5/unit.json` | 34,277 | `542de18d53e1cbb4c3e9a75701fbf5f98ab0592da4cbb2c91ee46a61e3ae01fc` |
| `verification/phase-5/integration.json` | 44,450 | `0b852cf7678cfbe784f9c87351a36b36b818d6ada0fa5a6f48604b560bf6a4e7` |
| `verification/phase-5/browser-results.json` | 9,980 | `3c9e677787e517ce76d16d9772d217100dc0b30a81572dd63607bcb2f0d3c264` |

This index is newly written provenance/navigation, not an original transcript message.
