# tqa run 2026-08-18-e2707e0 — MSEDB (tqa-fixes-2026-08-18-e2707e0 @ aeb377c)

Mode: fix (bare `/tqa` = fix mode per LESSONS.md) · Panel: opus, fable5, codex · Budget: extended past the default 10/2h (see note below) · Wall: ~5h (includes ~1.5h lost to sustained Anthropic API 529 overload across all three lanes and the judge)

**Target: production.** MSEDB has no staging/dev tier (accepted deviation STG-001..003 in CLAUDE.md) — prod on the DGX (`msedb.aptask.com`) is the only environment. Taj explicitly confirmed proceeding against prod, including DB/Redis/code, before Stage B started. Gauntlet phases 1–4 and all live probes were read-only or non-mutating; every fix was verified in an isolated container against mocked models, never by mutating live data or live customer mailboxes.

**Budget note:** the default fix budget is 10 findings/2 hours. This run fixed 12 CONFIRMED findings (all small, mechanical, no schema changes) because Taj explicitly asked mid-run to "finish what you have identified" rather than stop partway — flagged here rather than silently exceeded.

## Gauntlet

| Phase | Result | Detail |
|---|---|---|
| 1. Docker Infrastructure | PASS | 4/4 containers healthy on DGX (msedb-frontend/backend/mongo/redis), sha c57a706 |
| 2. Database Connectivity | PASS | Mongo `{ok:1}`, Redis `PONG` |
| 3. Environment Variables | WARN | `MONGO_PASSWORD`/`REDIS_PASSWORD` in `.env.example` but absent from `.env` — intentional, both services run no-auth by design per the compose file's own comment |
| 4. API Health & Smoke | PASS | `/api/health` and `/api/v1/health` both 200 `{"status":"healthy"}`; frontend 200 |
| 5. TypeScript / Lint | PASS (backend) / **GAP (frontend lint)** | Backend + frontend `tsc --noEmit`: 0 errors. Frontend `yarn lint` is broken today — no `eslint.config.js` anywhere in the repo and `eslint` isn't even a devDependency. Not fixed (see Carry-over: this is first-time tooling setup, not a regression, and out of scope for a bug-fix loop) |
| 6. Unit / Integration Tests | PASS | 90/90 pre-existing tests pass. One test (`health.test.ts`) initially timed out under Docker Desktop's Windows bind-mount I/O (`beforeAll` hook exceeded the 10s default); confirmed on a copied (non-bind-mounted) filesystem it passes 8/8 in <1s twice in a row at default timeouts — a test-harness artifact of this run's environment, not an app defect. No fix applied. |
| 7. E2E / Browser Smoke | Not run | Gate (phases 1–4) was satisfied via direct prod verification rather than a fresh boot; no Playwright suite exists in this repo |
| 8. Port Validation | PASS | 8010/3010/27020/6382 match CLAUDE.md's port table |

After all 12 fixes: full backend suite **19 files / 123 tests pass**, `tsc --noEmit` 0 errors (verified twice, once by the fix loop and once independently by `tverifier`).

## Confirmed findings (fixed)

| id | sev (re-graded) | area | claim | verifier | fix status |
|---|---|---|---|---|---|
| AUTH-01 | major | auth | Deleted user's still-valid session JWT kept authenticating (`activeUser?.isActive===false` is `false` when `activeUser` is `null`) | `requireAuth.test.ts` — mocks `User.findById`→`null`, asserts `UnauthorizedError` | FIXED@e5fabad |
| AUTH-02 | major | auth | Role trusted from JWT payload, never re-derived from DB — demoted admin kept `requireAdmin` access for the token's 24h life | `requireAuth.test.ts` — mocks DB role `user` against a token claiming `admin`, asserts `requireAdmin` throws `ForbiddenError` | FIXED@e5fabad |
| RULE-03 | major | rules | `PUT /api/rules/:id` never called `syncRuleToGraph` (unlike POST/PATCH-toggle), so an edited rule's Graph inbox rule kept acting on the old definition | `crud-put-sync.test.ts` — asserts `syncRuleToGraph` called with the right mailbox/token on a successful PUT | FIXED@e5fabad (code), @17a80aa (test — see commit-hygiene note below) |
| L2-001 / WH-01 | major | webhooks | Unauthenticated `POST /webhooks/graph` ran one `WebhookSubscription.findOne()` per item in an unbounded `value[]` array before any clientState check — only the 1MB body limit bounded it (~40k minimal items) | `webhooks-validation.test.ts` — 250-item batch asserts ≤100 `findOne` calls + truncation warn logged | FIXED@7120cbe |
| WH-03 | minor | webhooks | Lifecycle (renewal) notifications enqueued with no `jobId`, unlike change notifications — a redelivered lifecycle event produced duplicate renewal jobs | `webhooks-validation.test.ts` — asserts a `jobId` is now passed | FIXED@8a201c9 |
| WH-06 | minor | webhooks | Change-notification validation checked only subscriptionId+clientState, never the subscription's local status/expiry or changeType — stale-subscription processing after Graph should have stopped honoring it | `webhooks-validation.test.ts` — 3 new tests (rejects non-active sub, changeType allowlist, confirms lifecycle notifications stay exempt since their purpose is renewing an already-expired subscription) | FIXED@e14c1c6 |
| L2-002 | minor | tracking | `/track/open/:trackingId.png` read raw `X-Forwarded-For`/`X-Real-IP` instead of Express's `req.ip`, letting a pixel-URL holder forge either header to defeat the 5-min open dedup and poison geo data | `tracking-ip.test.ts` — asserts `recordOpen` receives `req.ip`, ignores forged headers | FIXED@f361866 |
| L2-003 / HEALTH-01 | minor | auth/health | `jwt.verify` had no `algorithms` allowlist (2 call sites); `/api/health`'s diagnostics gate checked signature validity only, never whether the user still exists/is active | `requireAuth.test.ts` (algorithms via existing coverage) + `health.test.ts` — 2 new tests (deleted user, deactivated user both denied diagnostics) | FIXED@2983b97 |
| CSRF-01 | minor | csrf | `validateCsrf` skipped on the mere presence of `Authorization: Bearer ` without validating the token, while `requireAuth` tries the session cookie first — reachable, but SameSite=lax + the CORS origin allowlist mean no live browser CSRF exists today (defense-in-depth, not an open bypass) | `csrf.test.ts` (new file) — asserts CSRF still enforced when a session cookie is present alongside a garbage Bearer header | FIXED@8ebc7f1 |
| NS-01 | minor | rules | `mailboxId` only truthiness-checked before a Mongoose filter — `{"$ne":null}` survived and became a live operator. Impact bounded: `userId` in the same filter keeps it to the caller's own mailboxes, never another user's | `crud-put-sync.test.ts` — 2 new tests (rejects non-ObjectId shape with 400, accepts a well-formed one) | FIXED@a5fb0aa |
| NS-03 | minor | rules | `senderEmail` truthiness- but not type-checked before `.toLowerCase()` in `delete-by-sender` — a non-string body value threw an uncaught TypeError → generic 500 instead of 400 | `crud-put-sync.test.ts` — 1 new test | FIXED@2a38f5c |
| ERR-01 | minor | errors | Global error handler recognized only `AppError`/`GraphApiError` — Express's own `SyntaxError` (malformed JSON) and `PayloadTooLargeError` (oversized body) fell through to a generic 500 instead of 400/413, also occasionally echoing body-parser's raw message | `errorHandler.test.ts` (new file) — 4 tests covering both new branches + the existing AppError/default paths | FIXED@6ac18d6 |
| ACT-01 | minor | actions | A Graph 404 breaking the action loop with nothing executed still unconditionally incremented `stats.totalExecutions`/`emailsProcessed` — over-counted rule effectiveness | `actionExecutor.test.ts` — 2 new tests (404-short-circuit skips `$inc` but keeps `lastExecutedAt`; normal run still increments) | FIXED@f016dd3 |

**Commit-hygiene note:** RULE-03's code fix landed accidentally bundled into the AUTH-01/AUTH-02 commit (e5fabad) — I edited `crud.ts` while waiting on a background test run and `git add -A` swept it in with the next commit. Both changes are individually correct and independently verified (each has its own passing test), but the commit boundary isn't clean. Not rewritten (project policy: create new commits, never amend) — noted here instead.

## Unreproduced / Advisory / Duplicate / Wontfix

| id | sev | verdict | evidence |
|---|---|---|---|
| L3-WH-01 | major | DUPLICATE of L2-001 | Same code, same fix, folded together |
| L3-WH-05 | minor | WONTFIX (judge-recommended) | 90s dedup window on change-notification jobId can theoretically collapse two genuinely distinct same-message updates within the window — but the code's own comment shows this is a deliberate, reasoned trade-off (collapsing Graph redeliveries), not an oversight. Left as-is. |
| L2-004 | minor | CONFIRMED but not fixed — posture decision | `/auth`,`/api` rate limiters fail *closed* on a Redis outage; `/webhooks`,`/track` fail *open* (documented). The asymmetry is real and undocumented for the first pair, but whether `/auth` should fail open or closed during a Redis outage is a security-posture call, not a bug — flipping it silently isn't mine to make. Recommend: make both `passOnStoreError` values explicit with a comment, whichever way Taj wants it. |

## Post-report additions (same run, after Taj said "finish all tasks, then tdev/tprod")

Taj explicitly asked to resolve the remaining deferred items rather than leave them open, and separately to land a pending fix from a prior session. Handled each on its own merits — genuine schema/scope decisions stayed deferred rather than being guessed at:

- **L3-ACT-02 — mitigated, not fully fixed (`aeb377c`)**. The complete fix (a per-action idempotency ledger) is still a schema change and still deferred — that rule doesn't bend regardless of instruction, since an unattended prod schema migration is a different risk class entirely. But re-reading the action set: `forward` is the *only* genuinely non-idempotent action here (`move`/`archive`/`flag`/`markRead`/`categorize` all either no-op or 404 cleanly on repeat, already handled). That narrows the real risk to exactly one case, closeable without a new field: before sending a forward, check whether a recent `AuditLog` row (already written by a prior attempt's `finally` block, existing schema) for this exact rule+message already recorded one, and skip if so. Verified: `actionExecutor.test.ts` 12/12 (2 new), full suite 125/125, tsc clean. This closes the actual customer-facing harm (duplicate email) while leaving the complete ledger design as future work.
- **L2-004 — resolved via explicit documentation, not a behavior change (`5918649`)**. Whether `/auth`/`/api` should fail open or closed on a Redis outage is a security posture call I'm not making unilaterally. Set `passOnStoreError: false` explicitly on both (identical to express-rate-limit's own default — genuinely behavior-neutral, confirmed by the full suite staying green) with a comment explaining the choice, so the asymmetry with webhooks/tracking is visible and deliberate instead of silent. If the posture should flip, that's now a one-line change for Taj to make, not a rediscovery.
- **Frontend `yarn lint`, still deferred, unchanged** — inventing a project-wide ESLint rule set, plugin selection, and style convention from nothing is a scope/tooling-adoption decision, not a bug fix, even under a "finish everything" instruction. Left as-is.
- **`PatternCard.tsx` aria-label fix (from the 2026-08-14 session, `5918649` — see commit-hygiene note)** — `Create a ${label} rule` produced "Create a Archive rule" for the Archive quick-action (wrong article before a vowel). Added a small `articleFor()` helper (`/^[aeiou]/i` check) used in both the aria-label and the hover tooltip, so it's correct for any future action label, not just today's three. Verified: frontend `tsc -b --noEmit` clean; manually confirmed `articleFor()` against all 3 real labels (Delete→a, Mark as read→a, Archive→an). No test framework exists for frontend components in this repo (Phase 6 gap noted below), so tsc is the available verifier.
- **`.gitignore` cleanup (`d4cde1d`)** — closes the other half of that same pending item: added `.taudit/`, `.playwright-mcp/`, and `.claude/troute-runs.md` (a hook-written dispatch log that had gotten accidentally swept into this run's very first checkpoint commit via `git add -A`) to `.gitignore`.

**Commit-hygiene note (second occurrence this run):** `PatternCard.tsx`'s edit landed bundled into the L2-004 commit (`5918649`) by the same `git add -A` pattern as the RULE-03 incident earlier in this run — both changes are individually correct and independently verified, but I should have run `git status` before every commit, not just some. Not rewritten (project policy: new commits only, never amend); noted here for the same reason as the first occurrence.

## Deferred (genuinely left open — needs a decision, not a mechanical fix)

**Frontend `yarn lint`** — no ESLint config exists anywhere in this repo, and `eslint` isn't even a devDependency. Not a regression; adopting lint tooling for the first time means picking a rule set, plugins, and style conventions, which is a project decision for Taj, not something to improvise mid-QA-run.

**L3-ACT-02's complete fix** (a per-action idempotency ledger) remains deferred — the interim mitigation above (`aeb377c`) closes the actual customer-facing risk (duplicate forwarded email) but is narrower than a real ledger, and still needs a schema change to do properly. See Carry-over.

## Lane scorecard

| lane | submitted | confirmed | unreproduced | duplicate | wall time | notes |
|---|---|---|---|---|---|---|
| Opus 5 (breadth) | 0 | — | — | — | ~35 min, all lost | 6 consecutive `529 Overloaded` across resume attempts over a sustained overload window; abandoned per own stated retry limit. No findings from this lane this run. |
| Fable 5 (depth) | 4 | 4 | 0 | 0 | ~18 min (recovered after 3× 529) | L2-001..L2-004 |
| Codex CLI (rival) | 15 | 13 | 0 | 1 (WH-01) | ~26 min, no overload hit | L3-WH-01,03,05,06, AUTH-01,02, CSRF-01, NS-01,03, ERR-01, ACT-01,02, RULE-03, HEALTH-01. Several "critical" severities did not survive judge re-derivation once CORS/SameSite/userId-scoping/downstream-idempotent-behavior were actually checked against source — expected for a lane that worked from a curated packet, not the live app or full repo. |
| Stage C judge (fresh-context Opus) | — | 17/19 judged CONFIRMED | 0 | 1 | ~25 min (recovered after 1× 529) | Re-derived every finding from source, performed safe live probes where the blast radius allowed (CSRF-01, ERR-01), declined live reproduction where it would have required a destructive prod action (ACT-02, AUTH-01/02, RULE-03, NS-01) and reasoned from source instead. |

The Opus breadth lane's total loss to API overload is the main coverage gap in this run — a systematic pass over every route/CRUD/auth-boundary never happened. Everything found came from the adversarial-depth and outside-lineage lanes, which by design sample high-risk flows rather than sweep exhaustively.

## Fix log

All 12 fixes on `tqa-fixes-2026-08-18-e2707e0`, checkpoint→fix→verify pattern, `--no-verify` per FIXLOOP convention (hooks not bypassed for any other reason):

1. `64559d1` checkpoint → `e5fabad` **AUTH-01+AUTH-02** (+ accidentally bundled RULE-03 code) → verified: tsc clean, `requireAuth.test.ts` 3/3
2. `e5fabad` → `17a80aa` **RULE-03** test-only commit (code was already in e5fabad) → verified: `crud-put-sync.test.ts` 1/1
3. `b4c781e` checkpoint → `7120cbe` **L2-001/WH-01** → verified: `webhooks-validation.test.ts` 11/11
4. `432f50a` checkpoint → `8a201c9` **WH-03** → verified: `webhooks-validation.test.ts` 12/12
5. `2332df2` checkpoint → `e14c1c6` **WH-06** → verified: `webhooks-validation.test.ts` 15/15
6. `d1ddb6c` checkpoint → `f361866` **L2-002** → verified: `tracking-ip.test.ts` 1/1
7. `9c5649d` checkpoint → `2983b97` **L2-003+HEALTH-01** → verified: `health.test.ts` 10/10
8. `0c6aa11` checkpoint → `8ebc7f1` **CSRF-01** → verified: `csrf.test.ts` 5/5
9. `c35016a` checkpoint → `a5fb0aa` **NS-01** → verified: `crud-put-sync.test.ts` 3/3
10. `b3e9dac` checkpoint → `2a38f5c` **NS-03** → verified: `crud-put-sync.test.ts` 4/4
11. `8421caf` checkpoint → `6ac18d6` **ERR-01** → verified: `errorHandler.test.ts` 4/4
12. `467e210` checkpoint → `f016dd3` **ACT-01** → verified: `actionExecutor.test.ts` 10/10

No reverts — every fix's targeted verifier passed on the first attempt, and the full 123-test suite stayed green throughout.

## Independent verification (tverifier, non-maker)

A separate `tverifier` agent re-ran the full suite from a clean container checkout of this branch (not the fix-loop's own run) and, for every one of the 12 fixes, read both the fixed source lines and the test asserting the fix, confirming the test exercises the actual guarded code path rather than passing vacuously (i.e. would also pass against the pre-fix code).

**VERDICT: PASS** — `tsc --noEmit` 0 errors, 19/19 test files, 123/123 tests, clean checkout, no stale cache.

| # | id | verdict | note |
|---|---|---|---|
| 1 | AUTH-01/02 | PASS | Role confirmed sourced from `activeUser.role`, never `decoded.role`; null-user rejection confirmed |
| 2 | RULE-03 | PASS | `syncRuleToGraph(ruleId, mailbox.email, token)` confirmed called inside PUT after `rule.save()` |
| 3 | L2-001/WH-01 | PASS | 250-item batch confirmed capped to ≤100 `findOne` calls + warn logged |
| 4 | WH-03 | PASS | Lifecycle `jobId` confirmed passed to the renewal queue `.add()` call |
| 5 | WH-06 | PASS | Status/expiry + changeType gating confirmed on change notifications only; lifecycle path confirmed still ungated |
| 6 | L2-002 | PASS | `recordOpen` confirmed called with `req.ip`, forged XFF/X-Real-IP headers confirmed unused |
| 7 | L2-003/HEALTH-01 | PASS | `algorithms:['HS256']` confirmed pinned in both files; DB re-check of user existence/active status confirmed in health.ts |
| 8 | CSRF-01 | PASS | Skip condition confirmed requires both no-session-cookie AND Bearer header |
| 9 | NS-01 | PASS | `isValidObjectIdString` confirmed gating both POST `/` and PUT `/reorder` before any query |
| 10 | NS-03 | PASS | `typeof senderEmail !== 'string'` confirmed gating before `.toLowerCase()` |
| 11 | ERR-01 | PASS | 400/413 mapping and body-parser-message stripping both confirmed in source |
| 12 | ACT-01 | PASS | Conditional `$inc` / unconditional `$set` split confirmed exactly as claimed |

No vacuous tests found across any of the 12.

## Carry-over (next run reads this first)

1. **L3-ACT-02's full fix** (major) — the shipped mitigation (`aeb377c`) closes the duplicate-forward case specifically; a real per-action idempotency ledger (covering every action type, not just forward) still needs a schema decision + migration before it can be built properly.
2. **Frontend `yarn lint`** — no ESLint config exists anywhere in this repo; not a regression, a first-time-setup gap. Deferred as a tooling/scope decision, not fixed inline.
3. **L3-WH-05** — closed as WONTFIX; revisit only if real-world evidence shows Graph redeliveries + genuine near-simultaneous updates actually collide in practice.
4. **Opus breadth lane never completed** — a systematic route/CRUD/auth sweep hasn't happened this run cycle; worth a dedicated re-run of just that lane once API capacity is normal.
5. **No frontend test framework** — `PatternCard.tsx`'s fix this run could only be verified with `tsc`, not a behavioral test; worth considering for a future audit if frontend logic complexity grows.
