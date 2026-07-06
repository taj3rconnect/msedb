# MSEDB — Fable 5 Improvement Plan (Master)

Date: 2026-07-06 · Branch: `feature/fable5-suggest` · Reviewer: Claude Fable 5 (8 parallel scoped review agents + parent synthesis)

This is the consolidated improvement plan. Detailed evidence lives in the eight companion docs:

| Doc | Scope | Findings |
|---|---|---:|
| [architecture-review.md](architecture-review.md) | Architecture + security | 1 High, 8 Med, 12 Low |
| [scalability-review.md](scalability-review.md) | Throttling, queues, scale | 2 High, 6 Med, 2 Low |
| [search-and-database-review.md](search-and-database-review.md) | Mongo schemas, indexes, search | 4 Crit, 4 High, 4 Med, 2 Low |
| [rule-engine-review.md](rule-engine-review.md) | Rule safety, dry-run, undo | 2 High, 3 Med, 2 Low |
| [qa-and-bug-report.md](qa-and-bug-report.md) | Bugs, tests, QA checklist | 1 High, 2 Med, 2 Low + 5 suspected |
| [refactor-plan.md](refactor-plan.md) | Duplication, typing, logging | 10 plan items |
| [large-file-split-plan.md](large-file-split-plan.md) | Files >1000 lines | 3 must-split + 1 opportunistic |
| [unused-code-report.md](unused-code-report.md) | Dead code, deps, config | 4 files + 5 exports safe-delete |

## Executive summary

The system is architecturally sound for its current single-instance scale: clean queue-based pipeline (webhook → BullMQ → pattern detection → suggestion → approved rule → executor), the core "never act without approval" contract is enforced at a single choke point (`ruleConverter.ts`), destructive actions route through a 24h staging grace period, and no IDOR was found across the route surface.

The problems cluster in four areas:

1. **Live correctness bugs** — dashboard/events aggregates match `userId` as a string instead of `ObjectId` (stats permanently zero); `patternEngine` uses a 1-day instead of 14-day minimum (2 tests failing today); duplicate webhook deliveries re-execute rule actions.
2. **Security debt** — Graph tokens stored **plaintext** in MongoDB (encryption utils exist, never called); unused `Calendars.ReadWrite` scope; Qdrant stores unencrypted body snippets with no TTL.
3. **Scale ceilings** — every worker at concurrency 1; serial all-mailbox loops in one job; no Graph `$batch`; single-retry 429 handling; no webhook job dedup; missing Mongo indexes force collection scans.
4. **Maintainability** — 3 files >1000 lines; 9 copies of the Graph pagination loop; 118 `req.user!` assertions; inconsistent error responses; ~4 dead files.

## Execution plan (this branch)

Phases run in order; each phase = one or more small commits, gated by `cd backend && yarn build && npx vitest run` and `cd frontend && yarn build && yarn lint`.

### Phase A — Bug fixes (SAFE, executing)
- A1. `patternEngine.ts:144` — restore the 14-day minimum observation window (fixes the 2 failing tests).
- A2. Cast `userId` to `ObjectId` in the 4 broken aggregates (`routes/dashboard.ts`, `routes/events.ts`). Route through one shared helper.
- A3. `eventCollector.ts` — skip rule evaluation when `saveEmailEvent` reports a duplicate (stops double-execution on webhook redelivery). (SF-1)
- A4. `actionExecutor.ts` — write audit log / rule stats in a `finally` so a mid-loop Graph error can't erase the trail of actions already taken.
- A5. Trivia: remove dead ternary `eventCollector.ts:426-436`; fix `graphClient.ts` semaphore docstring (2 vs 3).

### Phase B — Verified dead-code removal (SAFE, executing)
- Delete after re-verifying zero references at execution time: `backend/src/services/notificationService.ts`, `frontend/src/pages/ComingSoonPage.tsx`, `frontend/src/components/shared/MailboxSelector.tsx`, `frontend/src/hooks/useMailboxes.ts`, plus the 5 dead exports (incl. `aiSearch.ts` `aiSearchStatus`/`triggerBackfill`).
- Root `.mjs` one-off scripts and `msedb.xml`: **kept** pending owner confirmation.

### Phase C — Index additions (SAFE, executing)
- `EmailEvent`: compound `{userId, timestamp}`; index `receivedAt`. Additive, no behavior change.

### Phase D — Large-file splits (mandated, executing per large-file-split-plan.md)
- D1. `routes/mailbox.ts` (2163) → `routes/mailbox/` with subrouters; preserve the two load-bearing route orderings.
- D2. `frontend/src/pages/InboxPage.tsx` (2714) → 6 components + 2 hooks + 3 lib helpers.
- D3. `routes/rules.ts` (1012) → extract simulation + run-now execution into services (keeps current run-now behavior; the staging-bypass question is a product decision — see Skipped).
- D4. `InboxDataGrid.tsx` (935) → extract cell renderers (opportunistic).

### Phase E — Shared-helper refactors (executing, safest-first per refactor-plan.md)
- E1. `parsePagination()` helper (8 duplicate sites).
- E2. `getUserId(req)` helper (118 `req.user!` assertions).
- E3. Unify flat `{error}` responses through `AppError`/`globalErrorHandler` (7 sites; also fixes the frontend CSRF-retry latency bug).
- E4. `graphFetchAllPages()` shared pagination loop (9 sites) — last, highest blast radius; skipped if tests can't pin behavior.

### Final gate
- Full backend build + vitest, frontend build + lint, addin build if touched. Fix what breaks; anything unfixable → documented in the final report.

## Documented & SKIPPED — needs explicit approval (do not execute on this branch)

| # | Item | Why skipped | Source doc |
|--:|---|---|---|
| S1 | Encrypt Graph tokens at rest (wire up existing AES-256-GCM utils) | Requires migration of live tokens in prod Mongo; a botched rollout logs every user out or bricks refresh | architecture |
| S2 | Remove `Calendars.ReadWrite` scope | Azure app-registration + re-consent change (prod config) | architecture |
| S3 | Bump BullMQ worker concurrency / parallelize per-mailbox fan-out | Behavioral change under prod load; needs the idempotency fixes (A3) soaked first, then load verification | scalability |
| S4 | Graph `$batch` adoption + full 429/503 backoff rework | Large blast radius across every Graph call; do as its own reviewed branch | scalability |
| S5 | Run-now staging bypass (`skipStaging`) | Product decision: should manual "Run Now" honor the 24h staging grace period? Currently it bypasses it | rule-engine |
| S6 | Org-scoped rules never evaluated | Dead-but-visible feature — wire up or remove is a product call | rule-engine |
| S7 | Undo coverage for bulk runs (per-message audit entries) | Depends on S5 decision + audit schema change | rule-engine |
| S8 | Qdrant embedding reconciliation job + keyword fallback on ai-search 500 | New background job — feature work, not cleanup | search-db |
| S9 | Qdrant snippet TTL/encryption | Data migration on live vector store | architecture |
| S10 | `routes/events.ts:398` reads `ANTHROPIC_API_KEY` directly (bypasses config + local-LLM policy) | Policy decision: move to DGX Ollama or keep paid API | unused-code |
| S11 | Rate-limit bucket split for `/auth/login` vs `/auth/me`; Qdrant in `/api/health` | Low risk but prod-visible behavior; batch with S3/S4 branch | architecture |
| S12 | Webhook job `jobId` dedup + retry/backoff on all `queues.add()` sites | Pairs with S3; needs queue-drain testing | scalability |
| S13 | Rule-condition vocabulary gaps (regex, size, importance, multi-action, ordering) | Feature roadmap, not refactor | rule-engine |
| S14 | Data retention/purge policy (nothing is ever purged) | Product/compliance decision | search-db |

## Execution results (2026-07-06, this branch)

All phases A–E executed and verified: backend `tsc` clean, **38/38 vitest tests pass** (2 were failing before Phase A), frontend `tsc -b && vite build` clean.

- **Phase A+C** (`8d674ea`, `b7e1e68`): all 5 bug fixes + 2 indexes landed.
- **Phase B** (`aeb8819`): 4 dead files + 5 dead exports removed, each re-verified at zero references. Frontend `yarn.lock` was missing entirely — added (`ffd5551`).
- **Phase D** (`703827c`, `953ce43`): mailbox.ts 2164 → 10 subrouters; rules.ts 1012 → 776 (simulation + run-now extracted to `ruleEngine.ts`, run-now semantics preserved verbatim pending S5); InboxPage 2714 → 952 (+11 new modules); InboxDataGrid 935 → 612. No file exceeds 1,000 lines.
- **Phase E** (`4cfc696`): `parsePagination()` (8 sites), `getUserId()` (118 sites/24 files), AppError unification (8 sites), `graphFetchAllPages()` (8/9 sites — `deltaService.ts` loop intentionally kept: per-page progress, abort, deltaLink semantics).

New issues found during execution (not fixed here):
- `frontend yarn lint` is broken repo-wide — eslint is in no package.json and no config exists, despite CLAUDE.md documenting it. Add eslint or drop the script.
- No route-level tests exist for the mailbox/rules routers — splits were verified by build+line-preservation only; smoke-test mailbox + rules endpoints on next deploy.
- Three endpoints changed error-response shape (flat `{error}` → AppError shape, status codes unchanged): `/api/ai-search`, `/api/events/summarize-today*`, `/api/tracking/:trackingId` — verify their toast/error UI on next deploy.

## Recommended next steps (after this branch)

1. **S1 token encryption** — highest security value; do as its own branch with a lazy re-encrypt-on-refresh migration.
2. **Scale branch (S3+S4+S12)** — concurrency, $batch, backoff, dedup together, verified against a throttled test mailbox.
3. **Product decisions:** S5 (run-now staging), S6 (org rules), S10 (Anthropic key vs DGX Ollama), S14 (retention).
4. **QA:** adopt the QA checklist in qa-and-bug-report.md; add tests for actionExecutor, deltaService, webhook processing (currently untested).
