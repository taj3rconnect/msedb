# arch — MSEDB architecture assessment (2026-08-13)

Read-only assessment pass. Branch `audit/2026-08-13`. No code changed.

**Baseline (recorded before any hypothetical fix):**
- `cd backend && npx vitest run` → 9 files, 68 tests, all green.
- `cd backend && npx tsc --noEmit` → exit 0, clean.
- `cd frontend && npx tsc -b` → exit 0, clean.
- `cd frontend && yarn lint` → could not run in this sandbox (eslint binary not resolved under this session's node_modules) — treated as NOT_EVALUATED, not a defect; re-run in a normal shell.

**Context found in-repo:** `docs/large-file-split-plan.md` is a prior architecture assessment that has already been substantially executed — `mailbox.ts` (2,163 lines) is now split into `backend/src/routes/mailbox/*` (9 files), `rules.ts` (1,012 lines) into `backend/src/routes/rules/{crud,execute}.ts`, and `InboxPage.tsx` (2,714 lines) is down to 952 with `EmailPreviewPane`, `InboxCellRenderers`, `useInboxMutations`, `formatters.ts#highlightText` all extracted as that plan specified. Two items that plan explicitly deferred are still open and are re-surfaced below with fresh evidence (ARCH-06), or newly documented (ARCH-01) since it was flagged as "leave for follow-up" but not filed as a stable finding anywhere.

## Depth-gate verdicts (files ≥600 lines opened this pass)

| File | Lines | Verdict | Why |
|---|---|---|---|
| `backend/src/routes/patterns.ts` | 940 | **SHALLOW — split candidate** | Mixes HTTP handling with business logic: whitelist mutation (`unsilenceSenderForPattern`), rule-cascade deletion (`deleteRulesForPattern`), and bulk-suppression mailbox-grouping all live in the route file rather than a service. See ARCH-02. |
| `backend/src/routes/events.ts` | 660 | Deep — leave whole | 8 routes, one resource (event analytics/timeline/summarize), each route is query-building + aggregation for that one concern. No extracted business logic hiding in it. |
| `backend/src/services/ruleEngine.ts` | 415 | Deep by line count, but internally duplicated — see ARCH-03 | Under the 600-line threshold so not a split candidate; flagged for internal duplication instead. |
| `frontend/src/components/inbox/RuleActionsDialog.tsx` | 919 | Deep — leave whole (re-confirmed) | Matches the existing verdict in `docs/large-file-split-plan.md` §4.2: one cohesive form, ~19 `useState` fields converging on `handleConfirm`. Still true at current line count. |
| `frontend/src/components/ui/sidebar.tsx` | 726 | Exempt — vendored shadcn/ui | Never split vendored `components/ui/*`. |
| `frontend/src/pages/InboxPage.tsx` | 952 | Deep — leave whole | Down from 2,714 per the executed split plan; remaining content is orchestration doc already justifies as YAGNI to extract further. |
| `frontend/src/pages/ContactsPage.tsx` | 709 | Deep — leave whole | Single page, single resource (contacts), not opened line-by-line this pass beyond a structural scan — no evidence of mixed responsibility surfaced. |

## Findings

### ARCH-01 · HIGH · arch · impact H / effort L · status: OPEN
**Where:** `backend/src/routes/mailbox/messages.ts:62-88` and `backend/src/jobs/processors/bodyPrefetch.ts:38-61`
**Claim:** The CID inline-image substitution logic (rewrite `cid:` references in an HTML email body to `data:` URIs from fetched attachments) is implemented twice, near-verbatim, in the live message-fetch route and the body-prefetch BullMQ job. The prefetch file's own comment ("Inline CID image substitution (same logic as the live route)") acknowledges the duplication.
**Why it matters:** A future change to this logic (e.g. a new attachment content-type, a CID-format edge case) has to be made in two places or the cache and the live path silently diverge — a user could see an inlined image on first load (miss, live path) and a broken image after (hit, stale cached body from the other implementation).
**Fix:** Extract the block into one function, e.g. `inlineCidImages(body: {contentType?, content?}, attachments): void` in `backend/src/services/graphClient.ts` (or a new small `services/messageBody.ts`), and call it from both `messages.ts` and `bodyPrefetch.ts`.
**Verifier:** `grep -rc "att.contentId && att.contentBytes && att.contentType" backend/src/routes/mailbox/messages.ts backend/src/jobs/processors/bodyPrefetch.ts | awk -F: '{s+=$2} END{exit(s==2?1:0)}'` — currently both files match once each (exit 1 = fail, i.e. duplication still present); after consolidation only one shared implementation should contain the line (exit 0).
**Eligible for --fix:** yes

### ARCH-02 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/patterns.ts` (940 lines) — specifically `deleteRulesForPattern` (42-55), `unsilenceSenderForPattern` (299-334), the `hasRule` enrichment block inside `GET /` (96-190), and the mailbox-grouping loop inside `POST /bulk-suppress` (491-597)
**Claim:** The patterns route file contains substantial business logic — whitelist mutation, rule-cascade deletion, per-mailbox grouping for bulk suppression, and a hand-rolled sender/domain-to-rule lookup — instead of delegating to a service, unlike `patternBulkPlan.ts` which the same file already correctly extracts `classifyBulkTarget` into.
**Why it matters:** Per this repo's own layering convention (routes call services, services own domain logic — see `services/patternBulkPlan.ts`, `services/ruleConverter.ts`), this file is the outlier: its business rules can't be unit-tested without spinning up Express, and any second consumer of "delete rules for a pattern" or "unsilence a sender" (e.g. a future CLI/admin tool) would have to re-import from a route file.
**Fix:** Move `deleteRulesForPattern` and `unsilenceSenderForPattern` into a new `backend/src/services/patternRuleSync.ts` (sibling to the existing `patternBulkPlan.ts`), imported by the route the same way `classifyBulkTarget` already is. Do this as one mechanical move first — no behavior change.
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/patterns-bulk.test.ts src/routes/__tests__/patterns-hasRule.test.ts` — must stay green before and after the extraction (currently passes against the un-extracted code; re-run after the move to prove behavior preservation).
**Eligible for --fix:** yes

### ARCH-03 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/services/ruleEngine.ts` — `matchesConditions` (81-129), `simulateRule` (136-221), `findMatchingMessagesForRule` (238-300)
**Claim:** Sender-email/domain condition matching is reimplemented three separate times in the same file: as an in-memory predicate against a `GraphMessage` (`matchesConditions`), as a Mongo `$in`/regex filter builder (`simulateRule`), and as a client-side array filter against Graph-fetched messages (`findMatchingMessagesForRule`). Each independently re-derives "lowercase the address, split on `@` for the domain, support string-or-array `senderEmail`" — with no shared normalization helper, unlike `applyRuleActionsToMessages` in the same file, which explicitly documents (306-314) why its duplication of `actionExecutor.ts` is deliberate.
**Why it matters:** The three copies aren't identical (e.g. `matchesConditions` does an exact-match domain compare while other logic paths in the codebase historically used `endsWith`-style matching), so a bug fix or behavior change to "what counts as a sender-domain match" made in one place silently doesn't apply to the other two — the kind of drift the repo's own comment convention (see ARCH's neighbor duplication note) is trying to avoid elsewhere.
**Fix:** Extract two pure helpers — `normalizeSenderList(senderEmail: string | string[]): string[]` and `extractDomain(address: string): string` — into `ruleEngine.ts` itself (or `services/conditionMatch.ts` if it grows), and use them in all three functions. Bounded, no behavior change if the normalization matches current behavior exactly.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/ruleEngine.test.ts` — 12 tests currently pass against the triplicated code; must stay green after extraction (proves the shared helper reproduces all three call sites' current behavior).
**Eligible for --fix:** yes

### ARCH-04 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/webhooks.ts:42-106` and `backend/src/jobs/processors/webhookEvents.ts:16-25`
**Claim:** The Microsoft Graph webhook payload (`req.body.value`, a public unauthenticated-by-Express endpoint gated only by a `clientState` string compare) is passed into the job queue and later consumed via an unchecked `job.data as { notification: {...} }` cast — no runtime schema validation (e.g. zod) of `subscriptionId`, `changeType`, `resourceData.id` before they're used to build Mongo queries and log lines.
**Why it matters:** This is the one route in the app that accepts unauthenticated external input by design (Graph calls it directly) — per the repo's own type-safety doctrine ("unchecked external payloads crossing into the domain without validation"), it's the highest-value place in the codebase for a validation boundary, and currently has none. A malformed or adversarial notification (missing fields, wrong types) is caught only incidentally by whatever downstream code happens to guard against `undefined`.
**Fix:** Add a small zod schema (`GraphNotificationSchema`) in `backend/src/routes/webhooks.ts`, `.safeParse()` each entry of `req.body.value` before enqueueing, and drop (with a `logger.warn`) any that fail — same fire-and-forget shape, just validated first.
**Verifier:** `cd backend && npx tsc --noEmit` (passes now and after — this is a runtime-validation gap, not a type error) plus a new `backend/src/routes/__tests__/webhooks-validation.test.ts` asserting a malformed notification (e.g. `{ subscriptionId: 123 }`, wrong type) is rejected without throwing — file doesn't exist yet, so `npx vitest run src/routes/__tests__/webhooks-validation.test.ts` currently fails with "no test files found" and will pass once both the test and the schema exist.
**Eligible for --fix:** yes

### ARCH-05 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/events.ts:476`
**Claim:** `const isNewsletter = (e as any).metadata?.isNewsletter` — an `any` escape on a field that IS fetched (the `.select('sender subject importance isRead categories metadata.isNewsletter hasAttachments receivedAt')` on `EmailEvent.find(...).lean()` at line 434 explicitly projects it), but Mongoose's dotted-path `.select()` string isn't reflected in the inferred `.lean()` return type, so TypeScript doesn't know the field exists.
**Why it matters:** This is the only `as any` in non-test backend source (confirmed via repo-wide grep); it's a narrow, single-site type-safety hole with an easy fix, not a systemic problem — but it defeats the strict-mode guarantee (`tsconfig.json` has `strict: true`) for exactly the field it's reading.
**Fix:** Define a small lean-result type, e.g. `type InboxSummaryEvent = Pick<IEmailEvent, 'sender'|'subject'|'importance'|'isRead'|'categories'|'hasAttachments'|'receivedAt'> & { metadata: Pick<IEmailEventMetadata, 'isNewsletter'> }`, and type the `.lean()` call with it, removing the cast.
**Verifier:** `grep -c "as any" backend/src/routes/events.ts` — currently `1`, must be `0` after the fix (repo-wide policy already has zero elsewhere in non-test source, so this is enforceable as a standing grep-count check).
**Eligible for --fix:** yes

### ARCH-06 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/mailbox/*.ts` — 31 occurrences of `Mailbox.findOne({ _id: req.params.id, userId: ... })` / `Mailbox.findById(...)` ownership checks across `actions.ts`, `ai.ts`, `compose.ts`, `connection.ts`, `contacts.ts`, `folders.ts`, `messages.ts`, `settings.ts`, `whitelist.ts`
**Claim:** The mailbox-ownership lookup-and-404 pattern is hand-copied 31 times across the 9 mailbox subrouters. This was already identified and explicitly deferred in `docs/large-file-split-plan.md` §2.4 ("Known duplication left for a follow-up PR... A `router.param('id', ...)` middleware or `loadOwnedMailbox(req)` helper is the right dedup") at the time of the mailbox.ts split, but no follow-up has landed — the count today (31) is essentially the same shape the prior assessment found.
**Why it matters:** Any future change to the ownership-check semantics (e.g. adding org-level shared-mailbox access) requires touching 31 call sites correctly; a missed one is a silent authorization gap, not a loud failure.
**Fix:** Add `mailboxRouter.param('id', loadOwnedMailbox)` in `backend/src/routes/mailbox/index.ts` (attaches `req.mailbox`, throws `NotFoundError` once), then replace call sites one subrouter file at a time, per the existing plan's own recommended incremental order.
**Verifier:** `grep -rc "Mailbox.findOne({ _id: req.params.id" backend/src/routes/mailbox/*.ts | awk -F: '{s+=$2} END{print s}'` — currently `31` (script above); target is a small residual (routes that need the full document beyond `req.mailbox`, if any) — track the number down, verifier is "count strictly decreases from 31."
**Eligible for --fix:** yes

### ARCH-07 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/mailbox/actions.ts:130-134`
**Claim:** `try { await EmailEvent.bulkWrite(bulkOps); } catch { // Non-critical, log and continue }` — the comment promises a log call the code doesn't make; the error is fully discarded with zero trace.
**Why it matters:** Directly contradicts the repo's own "fail loud, never swallow" house rule (CLAUDE.md) and its own comment's stated intent in the same breath — if `bulkWrite` starts failing (e.g. a schema validation error introduced elsewhere), there will be no signal anywhere that read-state sync to `EmailEvent` silently stopped working.
**Fix:** Add the log call the comment already claims exists: `catch (err) { logger.warn('EmailEvent bulkWrite failed after apply-actions', { mailboxId: req.params.id, error: err instanceof Error ? err.message : String(err) }); }`.
**Verifier:** `grep -A2 "await EmailEvent.bulkWrite(bulkOps);" backend/src/routes/mailbox/actions.ts | grep -q "logger\."` — currently exits 1 (no logger call found); exits 0 once added.
**Eligible for --fix:** yes

### ARCH-08 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/rules/crud.ts:354-356`
**Claim:** In `POST /delete-by-sender`'s per-rule deletion loop, `catch { failed++; }` discards the actual error and only increments a counter — the caller learns "N rules failed" with no way to know why any specific one did.
**Why it matters:** Same house-rule violation as ARCH-07, in a bulk-delete path where a partial failure is exactly the case an operator needs a reason for (Graph 403, Mongo timeout, stale rule already deleted — currently indistinguishable).
**Fix:** `catch (err) { failed++; logger.warn('Failed to delete rule by sender', { ruleId: rule._id, error: err instanceof Error ? err.message : String(err) }); }`.
**Verifier:** `grep -A1 "catch {" backend/src/routes/rules/crud.ts | grep -q "logger\."` — currently exits 1; exits 0 once added.
**Eligible for --fix:** yes

## Not doing (and why)

- **Frontend/backend `Pattern`/`Rule` type mirroring** (`frontend/src/api/patterns.ts` explicitly comments "mirror backend Pattern model" against `backend/src/models/Pattern.ts`'s `IPattern`). This is duplication in the literal sense, but the repo has no shared-types package and frontend/backend are genuinely separate deployables (Vite SPA vs Express) — introducing a shared package is a real architectural change (build tooling, publish/link step), not a bounded first-change fix. Flagged here for visibility, not filed as a numbered finding: worth a deliberate decision, not an unattended one.
- **BullMQ worker consistency (11+ queues)** — reviewed `backend/src/jobs/queues.ts` and `schedulers.ts` in full: all 13 queues (CLAUDE.md's doc says 11; the repo has grown to 13 — `body-prefetch` and `embedding-reconcile` were added since) share one `defaultJobOptions` (retries, backoff, auto-remove) and one `completed`/`failed` logging block in the worker-creation loop. This is a PASS, not a gap — noted as a doc-drift item for the `app` dimension (CLAUDE.md's queue table is stale), not an arch finding.
- **`docs/large-file-split-plan.md`'s remaining item, the run-now staging-behavior product decision** (§3.2, referenced in `ruleEngine.ts`'s own comment at lines 306-314) — this is explicitly a pending product call, not an architecture defect; already correctly parked, re-confirmed still parked, not re-filed.

## Checks

```csv
check_id,dim,status,score,max,note
ARCH-BASELINE-01,arch,PASS,2,2,backend vitest run: 9 files / 68 tests green (baseline recorded)
ARCH-BASELINE-02,arch,PASS,2,2,backend npx tsc --noEmit: clean
ARCH-BASELINE-03,arch,PASS,2,2,frontend npx tsc -b: clean
ARCH-BASELINE-04,arch,NOT_EVALUATED,,2,frontend yarn lint: eslint binary not resolved in this sandbox session
ARCH-DEPTH-01,arch,PASS,1,1,RuleActionsDialog.tsx (919 lines) re-verdicted deep/leave-whole per docs/large-file-split-plan.md §4.2
ARCH-DEPTH-02,arch,PASS,1,1,sidebar.tsx (726 lines) exempt — vendored shadcn/ui
ARCH-DEPTH-03,arch,PASS,1,1,InboxPage.tsx (952 lines) deep/leave-whole — prior split plan executed
ARCH-DEPTH-04,arch,PASS,1,1,events.ts (660 lines) deep/leave-whole — single-resource analytics router
ARCH-DEPTH-05,arch,FAIL,0,2,patterns.ts (940 lines) shallow — business logic mixed into route handlers (ARCH-02)
ARCH-DUP-01,arch,FAIL,0,3,CID inline-image logic duplicated verbatim in messages.ts and bodyPrefetch.ts (ARCH-01)
ARCH-DUP-02,arch,FAIL,0,2,sender/domain condition matching triplicated in ruleEngine.ts (ARCH-03)
ARCH-DUP-03,arch,FAIL,0,2,mailbox ownership-check duplicated 31x across routes/mailbox/*.ts (ARCH-06)
ARCH-TYPE-01,arch,FAIL,0,1,as any type escape in events.ts:476 on a projected-but-untyped field (ARCH-05)
ARCH-TYPE-02,arch,FAIL,0,2,unvalidated external webhook payload cast crosses trust boundary (ARCH-04)
ARCH-ERR-01,arch,FAIL,0,1,swallowed catch in mailbox/actions.ts contradicts its own comment (ARCH-07)
ARCH-ERR-02,arch,FAIL,0,1,swallowed catch in rules/crud.ts bulk-delete loses per-rule failure reason (ARCH-08)
ARCH-ERR-03,arch,PASS,1,1,globalErrorHandler centralizes AppError/GraphApiError mapping — no per-route reimplementation found
ARCH-QUEUE-01,arch,PASS,2,2,BullMQ queues/workers share one defaultJobOptions + one completed/failed logging block (queues.ts) — consistent shape across all 13 queues
ARCH-QUEUE-02,arch,PASS,1,1,concurrency overrides (webhook-events:4, pattern-analysis:2, contacts-sync:2) are explicitly commented with the race/ordering rationale, not silent tuning
ARCH-LAYER-01,arch,PASS,1,1,patternBulkPlan.ts / ruleConverter.ts confirm the route-calls-service pattern exists and is followed elsewhere in the same domain
```

Weights: CRITICAL 5 / HIGH 3 / MEDIUM 2 / LOW 1. Score = max on PASS, 0 on FAIL, empty on NOT_EVALUATED.
Evaluated: 20 checks. Passed: 12. Failed: 8. Not evaluated: 1 (lint, environment issue).
