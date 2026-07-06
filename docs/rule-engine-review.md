# MSEDB Rule Engine Review

Reviewed: `backend/src/models/Rule.ts`, `routes/rules.ts`, `routes/admin.ts` (org-rules),
`services/ruleEngine.ts`, `ruleConverter.ts`, `actionExecutor.ts`, `graphRuleSync.ts`,
`undoService.ts`, `stagingManager.ts`, `eventCollector.ts`,
`jobs/processors/stagingProcessor.ts`, `jobs/processors/webhookEvents.ts`,
`services/patternEngine.ts`, and the existing test suites under `services/__tests__/`.

Core UX contract under test: **never create/execute a mailbox rule without explicit
user approval.** Verdict: holds for rule *creation* (manual POST, pattern-approve,
admin org-rule — all require an explicit authenticated request). It does **not** fully
hold for rule *execution safety* — see Safety Findings, especially SF-1 and SF-2.

---

## 1. Current Rule Engine Design

**Representation** (`models/Rule.ts:3-42`): a `Rule` document has `conditions`
(`senderEmail|string[]`, `senderDomain`, `subjectContains`, `bodyContains`, `fromFolder`
— AND-only, no NOT/OR), an `actions[]` array with an `order` field for sequencing, a
`priority` (int, ascending = first-evaluated), `isEnabled`, `skipStaging`, and a
`scope: 'user' | 'org'` field.

**Evaluation** (`services/ruleEngine.ts:28-68`, real-time path only): for each inbound
message, `evaluateRulesForMessage()` runs a strict 3-step gate: (1) kill switch
(`User.preferences.automationPaused`), (2) sender whitelist, (3) `Rule.find({ userId,
mailboxId, isEnabled: true }).sort({priority:1})` and returns the **first** rule whose
`matchesConditions()` (ruleEngine.ts:78-126, pure function, unit-tested) returns true.
First-match-wins — later rules never fire once one matches, and there is no
"continue processing" escape hatch (Outlook has one; MSEDB doesn't).

**Execution** has two independent code paths that do not share logic:
- **Automated** (`eventCollector.ts:303-355` → `actionExecutor.ts:22-263`): runs on
  every Graph webhook `created` notification. Staging-aware, per-message audit trail,
  graceful 404 handling.
- **Manual bulk "Run Now"** (`routes/rules.ts:573-853`, `POST /api/rules/:id/run`):
  fetches all unread Graph messages, re-implements condition filtering client-side
  from scratch (does **not** reuse `matchesConditions()`), and re-implements action
  execution from scratch (does **not** reuse `executeActions()`). See SF-1/SF-2.

**Sync to Outlook**: `graphRuleSync.ts` mirrors a subset of MSEDB rules into real
Graph `messageRule`s server-side (sender/domain conditions only — `subjectContains`/
`bodyContains` are not synced, graphRuleSync.ts:47-54) so matching mail is
processed even when MSEDB itself is down. Every Graph rule sets
`stopProcessingRules: true` (graphRuleSync.ts:58).

**Patterns → Rules**: `patternEngine.ts` detects sender/folder-routing behavior with
pure, unit-tested scoring functions (`calculateConfidence`, `shouldSuggestPattern`,
patternEngine.ts:101-156) and only ever writes `status: 'suggested' | 'detected'`.
Conversion to a live `Rule` happens exclusively in `ruleConverter.convertPatternToRule()`,
gated on `pattern.status === 'approved'` (ruleConverter.ts:58-60), which is only ever
set by the user hitting `POST /api/patterns/:id/approve` (routes/patterns.ts:321-352).
Idempotent — re-approving/re-converting the same pattern returns the existing rule
(ruleConverter.ts:62-70).

---

## 2. Condition / Action Gap Table

| Capability | Outlook desktop rules | MSEDB today | Gap |
|---|---|---|---|
| Sender email / list | Yes | Yes (`senderEmail`, array) | — |
| Sender domain | Yes (via "contains @domain") | Yes | — |
| Subject contains | Yes | Yes (`subjectContains`, single substring) | No multi-keyword, no regex, no "starts with"/"exact" |
| Subject regex / exact match | No native regex either | No | Neither has it — no gap |
| Body contains | Yes | Yes, but **client-side only** and **skipped entirely in `/simulate`** (rules.ts:352-353, "EmailEvent doesn't store body") | Simulated match count is wrong/undercounted for any rule using `bodyContains` |
| Sent to / Cc contains | Yes | No | Missing |
| Marked with importance | Yes | Stored on `EmailEvent` (`importance` field exists) but **not a rule condition** | Missing |
| Has attachment | Yes | Metadata captured (`hasAttachments`) but not a condition | Missing |
| Message size | Yes | No | Missing |
| Category assigned | Yes | Action only, not a condition | Missing as condition |
| From specific folder | Yes ("on this machine only" analog) | Yes (`fromFolder`) — **but silently ignored by the bulk "Run Now" executor** (see SF-2) | Partial — condition exists, one execution path drops it |
| Multiple conditions (AND) | Yes | Yes (all set conditions AND'd, ruleEngine.ts:78-126) | — |
| OR / NOT conditions | Yes (limited) | No — pure AND only | Missing |
| Move to folder | Yes | Yes | — |
| Copy (non-destructive) | Yes | No — only destructive `move`/`delete` | Missing |
| Delete (to Deleted Items) | Yes | Yes, staged with 24h grace in automated path (`actionExecutor.ts`) | — |
| Permanently delete | Yes | **Not implemented anywhere** — deliberate, correct safety choice | No gap (intentional) |
| Forward / redirect | Yes (both, subtly different) | Only `forward` (adds a comment, changes From) | Minor — no true "redirect" |
| Mark as read | Yes | Yes | — |
| Flag for follow-up | Yes | Yes (`flag`, one status only) | No due-date/flag-type options |
| Categorize | Yes | Yes, single category (`action.category`, singular) | No multi-category assign |
| Popup / alert | Yes (desktop alert) | Yes (`popup`, via Socket.IO) | — |
| Stop processing more rules | Yes, opt-in per rule | **Implicit and mandatory** — first-match-wins, no per-rule opt-out (ruleEngine.ts:56-65) | Can't compose two independent rules against the same message |
| Run a script | Yes | No | Not requested — skip (YAGNI) |
| Rule priority / ordering | Yes (manual reorder) | Yes, drag-and-drop (`PUT /api/rules/reorder`, rules.ts:423-459) | — |
| Rule templates / sharing across mailboxes | No native Outlook equivalent | Only via `scope: 'org'` — and that scope is **never evaluated** (see SF-4) | Effectively missing |

---

## 3. Composability, Reusability, Testability

- **Pure & tested**: `matchesConditions()` (ruleEngine.ts) and the confidence-scoring
  functions in `patternEngine.ts` are pure and covered by
  `services/__tests__/ruleEngine.test.ts` and `patternEngine.test.ts`. `actionExecutor.ts`
  has a mocked-Graph unit test (`actionExecutor.test.ts`). Good foundation.
- **Not tested**: `routes/rules.ts` (the `/run`, `/simulate`, create/update/delete
  routes — no route test file exists, only `routes/__tests__/patterns-hasRule.test.ts`
  which covers a different route), `graphRuleSync.ts`, `ruleConverter.ts`,
  `undoService.ts`, `stagingProcessor.ts`. The single riskiest piece of code in the
  system — the bulk manual executor — has zero test coverage.
- **Two independent condition/action implementations**: `ruleEngine.ts` +
  `actionExecutor.ts` (automated) vs. inlined logic in `routes/rules.ts:596-826`
  (manual run). They have already drifted (fromFolder support, staging behavior —
  see SF-2/SF-1). This is the main reusability gap: fix once by making `/:id/run`
  call the existing `matchesConditions()`/`executeActions()` instead of re-deriving
  the same behavior with different bugs.
- **Templating/sharing across mailboxes**: `scope: 'org'` exists on the model
  (Rule.ts:38) and has an admin-only creation route (admin.ts:229-268), but nothing
  reads `scope` when evaluating rules for a message (ruleEngine.ts:50-54 filters only
  by `userId`+`mailboxId`) — org rules can be created but never fire (SF-4).

---

## 4. Bulk Safety

- **Idempotency**: `saveEmailEvent()` dedupes `EmailEvent` writes via a Mongo unique-index
  duplicate-key catch (`eventCollector.ts:22-57`, returns `false` on dup). However,
  rule evaluation/execution in `handleCreated()` runs **unconditionally after** that
  call, regardless of whether the save was a duplicate (`eventCollector.ts:264-355` —
  the `if (saved)` guard at line 267 only gates the embedding/prefetch job enqueues,
  not the `evaluateRulesForMessage`/`executeActions` call a few lines below). Graph
  webhooks are explicitly at-least-once delivery, so a redelivered `created`
  notification re-runs the matched rule's actions a second time. See SF-1.
- **Ordering guarantees**: priority is a plain integer, reassigned atomically via
  `bulkWrite` on reorder (rules.ts:448-456) — fine. Real-time evaluation is
  synchronous first-match — no ordering issue there.
- **What happens at 100k matches**: the automated per-message path is naturally
  throttled (one message per webhook event, queued through BullMQ). The
  **manual bulk path is not**: `POST /:id/run` fetches *all* unread messages via
  `@odata.nextLink` pagination into one in-memory array (rules.ts:613-628, no cap),
  then applies actions in a **sequential `for` loop with `await` per message and no
  concurrency limit, no batching, no 429 backoff, and no resumability** if the
  process restarts mid-run (rules.ts:677-760). Contrast with
  `stagingProcessor.ts:39-65`, which chunks work 5-at-a-time via
  `Promise.allSettled` and explicitly handles Graph 429s by deferring to the next
  scheduled run (stagingProcessor.ts:192-199). A 100k-message rule run today would be
  slow, fragile to rate-limiting, and unrecoverable mid-flight.

---

## 5. Destructive-Action Safety

- **Automated path is well-guarded**: `actionExecutor.ts:9-21` — deletes are *never*
  permanent; they're routed through a dedicated "MSEDB Staging" folder
  (`stagingManager.ts:26-69`) with a `StagedEmail` record carrying a 24h `expiresAt`
  grace period (`stagingManager.ts:85-100`) before `stagingProcessor.ts` executes the
  real soft-delete (`deleteditems`, never a Graph permanent-delete call — confirmed,
  no such call exists anywhere in the codebase). Rescue (`rescueStagedEmail`,
  `batchRescueStagedEmails`) fully reverses a staged action before it fires.
- **Manual bulk run bypasses staging entirely**: `routes/rules.ts:681-690` calls
  Graph `move → deleteditems` directly, with `skipStaging` semantics baked in
  regardless of the rule's actual `skipStaging` flag — there is no 24h grace period,
  no `StagedEmail` record, and no popup/notification before it happens. The only
  "preview" available is the separate `/simulate` endpoint, which is optional and not
  enforced (see SF-1 wording — same evidence, different angle: SF-2 below).
- **Rollback/undo (`undoService.ts`) coverage**: handles exactly three audit
  `action` types — `rule_executed` (reverses move/archive/markRead/categorize/flag by
  replaying the inverse Graph call, in reverse order; delete is *not* reversed here,
  it's deferred to the staging flow — undoService.ts:143-198), `email_executed` (move
  back from Deleted Items to `originalFolder` — undoService.ts:231-279), and
  `email_staged` (rescue — undoService.ts:286-348). All respect a hard 48-hour window
  (`UNDO_WINDOW_MS`, undoService.ts:11, 49-52) and gracefully no-op on Graph 404
  (message purged by retention) instead of throwing.
- **Undo cannot cover the bulk "Run Now" path** even though it "executes" a rule:
  the audit entry it writes (`rules.ts:835-843`) only has
  `{ matched, applied, failed }` counts — no `messageId`, no per-message `actions`,
  no `originalFolder`. `undoRuleExecuted()` requires exactly those fields
  (`undoService.ts:127-138`) and will throw `ValidationError('Audit entry missing
  messageId')` if invoked against a bulk-run entry. In practice a user cannot undo a
  bulk "Run Now" at all, silently.
- **Audit trail completeness**: every mutating route (create/update/toggle/delete/
  delete-by-sender) writes an `AuditLog` entry with before/after state
  (rules.ts:224-232, 503-515, 552-561, 930-938, 998-1007) — good. Bulk run is the one
  exception, logging only aggregate counts.

---

## 6. Safety Findings

| ID | Severity | File:Line | Finding |
|---|---|---|---|
| SF-1 | **High** | `eventCollector.ts:264-355` (rule eval not gated by `saved` from line 264) | Duplicate webhook delivery of the same `created` notification re-runs `evaluateRulesForMessage`/`executeActions` a second time even though the `EmailEvent` write was correctly deduped. Idempotent-ish for move/delete/markRead (Graph 404s gracefully), but a `forward` action sends a **second real email** to the recipient, and a `delete` action creates a **second independent `StagedEmail` record** for the same message (`stagingManager.ts` has no unique constraint on `messageId`, only `{userId,status,expiresAt}` and a TTL index — StagedEmail.ts:58-60) — two independent 24h timers, and rescuing one doesn't rescue the other. |
| SF-2 | **High** | `routes/rules.ts:632-668` vs. `681-690` | `POST /:id/run` (bulk manual "Run Now") re-implements condition matching from scratch and **never filters on `conditions.fromFolder`** — a rule scoped to a specific folder will match and act on unread messages in *every* folder when run manually. It also re-implements action execution from scratch, bypassing the staging/grace-period safety net that the automated path always uses (`actionExecutor.ts`) — deletes go straight to `deleteditems` with no rescue window, contradicting SF-well-established behavior elsewhere in the same app. |
| SF-3 | **Medium** | `routes/rules.ts:677-760` | Bulk run applies actions to matched messages in a plain sequential `for` loop, unbounded, with no concurrency cap, no 429 backoff, and no persisted progress — a large mailbox (the "100k messages" case) is slow, not resumable, and not resilient to Graph rate-limiting, unlike `stagingProcessor.ts` which chunks 5-at-a-time and defers on 429. |
| SF-4 | **Medium** | `routes/admin.ts:229-268` vs. `services/ruleEngine.ts:50-54` | Org-wide rules (`scope: 'org'`) can be created via an admin-only endpoint but are **never evaluated** — `evaluateRulesForMessage` only queries by `userId`+`mailboxId`, and org rules are created without a `mailboxId`. The feature is a dead no-op today; an admin creating one would reasonably believe it's live. |
| SF-5 | **Low** | `routes/rules.ts:835-843` | Bulk "Run Now" audit entries lack the per-message detail (`messageId`, `actions`, `originalFolder`) that `undoService.ts:127-138` requires — bulk-run actions are effectively **not undoable**, with no user-facing warning that this is the case. |
| SF-6 | **Low** | `routes/rules.ts:352-353` | `/simulate` silently skips `bodyContains` matching ("EmailEvent doesn't store body text"), so the preview count for any rule using a body condition is inaccurate — understating what a subsequent `/:id/run` will actually match/act on. |
| SF-7 | **Low** | `services/ruleEngine.ts:56-65` | Strict first-match-wins across rules with no per-rule "continue processing" flag means two independently-authored rules can never both act on the same message — forces users to encode everything as one rule's multi-action array, reducing composability versus Outlook's model. |

---

## 7. Recommendations (prioritized)

**P0 — safety-critical, small diffs, do first:**
1. **Fix SF-1**: move the `evaluateRulesForMessage`/`executeActions` call inside the
   `if (saved) { ... }` block in `eventCollector.ts` (or add an explicit `if (!saved)
   return;` right after the `saveEmailEvent` call, before rule evaluation). One-line
   structural fix, closes the duplicate-action hole entirely.
2. **Fix SF-2**: delete the hand-rolled matching/execution code in
   `routes/rules.ts` (`/:id/run`) and call `matchesConditions()` (ruleEngine.ts) for
   filtering and `executeActions()` (actionExecutor.ts) for applying actions, per
   matched message. This simultaneously fixes the missing `fromFolder` filter and
   gives bulk-run the same staging/grace-period safety and per-message audit trail
   the automated path already has — for free, since it's reuse rather than new code.
3. **Guard staged-email duplication**: add a partial unique index on
   `StagedEmail` (`{ mailboxId: 1, messageId: 1, status: 1 }`, filtered to
   `status: 'staged'`) so a second staging attempt for the same message
   is a no-op instead of a second independent timer.

**P1 — needed before "100k messages" is a safe real-world case:**
4. Give the (now-shared) bulk executor from fix #2 the same chunked
   concurrency + 429 backoff as `stagingProcessor.ts` (`Promise.allSettled` in
   batches of 5), plus a persisted cursor/progress count so a restart resumes
   instead of re-scanning from zero.
5. Make preview mandatory before bulk apply: have `/simulate` return a
   short-lived `confirmationToken` (e.g., signed, tied to rule id + conditions
   hash, 5 min TTL) and require `/:id/run` to receive it — turns "always simulate
   first" from a UI convention into a backend-enforced guarantee. Also fix SF-6
   (body preview accuracy) since the token's count needs to be trustworthy.

**P2 — cleanup / clarity, lower urgency:**
6. Resolve SF-4: either wire `scope: 'org'` into `evaluateRulesForMessage` (fan out
   org rules across all mailboxes in the org) or remove the `admin.ts` org-rules
   endpoints until that's built — a rule an admin believes is protecting the org but
   isn't is worse than no feature.
7. Address SF-5 by making bulk-run write one lightweight per-message audit entry
   (or at minimum the list of matched `messageId`s) so undo has something to act on
   — doesn't need full parity with the per-action detail of the automated path, just
   enough for `undoService` to reverse a mistaken bulk apply.
8. Only if there's a real user request: add a per-rule "continue processing" flag
   (SF-7) and expand the condition vocabulary (importance, hasAttachments, size,
   sent-to) from the gap table — no need to build these speculatively.

No changes recommended to: permanent-delete avoidance (already correctly absent),
the 48-hour undo window, the kill-switch/whitelist gating order, or the
pattern-approval-before-rule-conversion flow — all verified sound.
