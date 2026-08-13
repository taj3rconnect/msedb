# FINDINGS.md — MSEDB /taudit — 2026-08-13

**Run:** `/taudit --fix` (attended) · branch `audit/2026-08-13` · start ref `53f9910`
**standard_version:** 2026.07 · **Dims:** app db ui arch security reliability perf tests (8/8 reported)
**Baseline (verified by orchestrator, not a delegate):** `cd backend && yarn build` → exit 0 ·
`cd backend && yarn test` → exit 0, 68/68 passing across 9 files · `cd frontend && npx tsc -b` → exit 0.

**Trend:** baseline run — `docs/reports/audit-scorecard.csv` had no prior row, so no per-check diff is
available. A narrative predecessor exists (`docs/tauditall-2026-08-08.md`) and items unchanged since it
are marked *(open since 2026-08-08)*; that file has no `checks.csv`, so a numeric trend is **UNPROVEN**
rather than guessed.

---

## Orchestrator corrections to dim-agent findings

Four claims were re-verified directly and changed. Recorded here because a silently-adjusted
severity is indistinguishable from a fabricated one.

| Item | Agent said | Verified result | Change |
|---|---|---|---|
| **APP-01** | CRITICAL, committed key material | Confirmed **and escalated** — remote `taj3rconnect/msedb` is **PUBLIC** (`gh repo view` → `isPrivate:false`) | Severity held CRITICAL; blast radius widened to public internet |
| **SEC-CHK-01** | PASS — "no committed secret" | **FALSE.** The security lens scoped its sweep to `.env`/inline assignments and missed the tracked key material APP-01 found. `git ls-files` confirms 3 credential files tracked | PASS → **FAIL** |
| **SEC-01** | HIGH — NoSQL injection | Injection is **real**, but the `clientState` equality gate at `webhooks.ts:58` still blocks forgery; attacker cannot satisfy it | HIGH → **MEDIUM** |
| **SEC-02** | HIGH — IDOR | Ownership check **is** missing, but the `EmailEvent` filter is `userId`-scoped (`events.ts:38,392,535`), so no cross-tenant event data is returned — leak is limited to resolving another mailbox's email | HIGH → **MEDIUM** |
| **ARCH-BASELINE-04** | NOT_EVALUATED — "sandbox issue" | Not environmental: `frontend/` has **no eslint dependency and no config file** | NOT_EVALUATED → **FAIL** |

---

## This week — CRITICAL, and high-impact/low-effort

### APP-01 · CRITICAL · app · impact H / effort M · status: OPEN
**Where:** `certs/selfsigned.key`, `.cloudflared/cert.pem`, `.cloudflared/acdd721a-a650-44c3-824f-6ff106899581.json` (all added in `d6e8ce9`)
**Claim:** Three credential-bearing files are tracked in git — a TLS private key, a Cloudflare account/origin certificate, and the tunnel credentials (TunnelSecret) for tunnel `acdd721a` — and the GitHub remote is **PUBLIC**. Flagged as SEC-002 on 2026-08-08 and still unrotated; `.gitignore` was updated but the files were never untracked, so the ignore rule does nothing.
**Why it matters:** The tunnel credentials let anyone run the `msedb` tunnel and serve/intercept `msedb.aptask.com`; the account cert authorizes creating and managing tunnels on the Cloudflare account. Public repo + 5 days unrotated = assume compromised.
**Fix:** ROTATION FIRST, out-of-band: (1) delete and recreate the `msedb` tunnel so the leaked credentials die, (2) revoke/reissue the account cert via `cloudflared tunnel login`, (3) regenerate `certs/selfsigned.{crt,key}`, (4) `git rm --cached` the three paths and commit, (5) purge history (`git filter-repo`/BFG + force-push), (6) consider making the repo private.
**Verifier:** `git ls-files -- 'certs/*.key' '.cloudflared/*.pem' '.cloudflared/*.json'` — currently lists 3 files (exit-1 assertion fails); passes on empty output.
**Eligible for --fix:** **no** — committed credentials are rotation-first and never auto-fixed.

### REL-01 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/services/eventCollector.ts:140-148`
**Claim:** `processChangeNotification()` wraps its whole body in a try/catch that only logs and returns — never rethrows. `processWebhookEvent()` (`jobs/processors/webhookEvents.ts:33`) just awaits it, so every `webhook-events` job reports "completed" to BullMQ no matter what failed.
**Why it matters:** `queues.ts:25-30` configures `attempts: 3` with backoff precisely so transient failures retry. That retry path is **dead code** for the app's primary mail-ingestion route: a transient Graph 5xx or DB blip silently drops the notification, with no dead-letter, no `/api/health` signal, no operator trace.
**Fix:** Rethrow after logging in `processChangeNotification` (or move the try/catch up into `processWebhookEvent`) so BullMQ sees the failure and exhausted retries land in the `failed` set.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/eventCollector.test.ts` — file absent now; passes once the test asserts the promise rejects on a non-404 Graph error.
**Eligible for --fix:** yes

### REL-03 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/routes/health.ts:36-129`
**Claim:** `/api/health` gates healthy/degraded on MongoDB and Redis only. It never calls `checkOllamaHealth()` (`ollamaClient.ts:156`) or `getCollectionInfo()` (`qdrantClient.ts:187`) — both already written, exported, and unused.
**Why it matters:** CLAUDE.md states `/api/health` plus the watchdog are the **only** safety net in this one-environment app. A health endpoint reporting "healthy" while Qdrant (a documented hard dependency per `RUNBOOK.md:76`) or Ollama is down actively hides the failure class REL-02 describes.
**Fix:** Call both helpers in `health.ts` and surface them in the `services` block (may stay non-gating, must be visible).
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/health.test.ts` — fails now (route emits no such fields); passes once it reports qdrant + ollama status.
**Eligible for --fix:** yes

### REL-02 · HIGH · reliability · impact H / effort L · status: OPEN
**Where:** `backend/src/services/ollamaClient.ts:20-37`, `:83-101`, `:128-151`
**Claim:** `generateEmbedding`, `parseSearchQuery`, and `generateOllamaCompletion` call `fetch()` with **no `AbortSignal`/timeout** — while `checkOllamaHealth` at `:160` correctly passes `AbortSignal.timeout(3000)`.
**Why it matters:** `generateEmbedding` runs inside the `email-embedding` processor, whose queue has no concurrency override and so defaults to 1. A hung Ollama (GPU busy, model swap) blocks that single worker **forever** — never times out, never fails, never frees the slot — and nothing surfaces it.
**Fix:** Pass `signal: AbortSignal.timeout(30_000)` on all three calls; the resulting AbortError flows into the existing 2-attempt retry.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/ollamaClient.test.ts` — fails now; passes once a never-resolving fetch is asserted to reject within a bounded wait.
**Eligible for --fix:** yes

### ARCH-01 · HIGH · arch · impact H / effort L · status: OPEN
**Where:** `backend/src/routes/mailbox/messages.ts:62-88` and `backend/src/jobs/processors/bodyPrefetch.ts:38-61`
**Claim:** CID inline-image substitution (rewriting `cid:` refs to `data:` URIs) is implemented twice near-verbatim; the prefetch file's own comment admits it ("same logic as the live route").
**Why it matters:** The two paths can silently diverge — a user sees an inlined image on a cache miss (live path) and a broken one on a hit (cached path written by the other implementation).
**Fix:** Extract to one `inlineCidImages(body, attachments)` helper in a new `services/messageBody.ts`; call from both sites.
**Verifier:** `cd backend && yarn build && yarn test` must stay green, plus the shared helper exists in exactly one file.
**Eligible for --fix:** yes

### DB-02 · HIGH · db · impact H / effort L · status: OPEN  *(dedup: also found as PERF-03)*
**Where:** `backend/src/routes/admin.ts:406-434` (`POST /api/admin/prefetch-unread-bodies`)
**Claim:** `EmailEvent.find({eventType:'arrived', isRead:false, isDeleted:false})` has no `.limit()`, no `.lean()`, no batching — loading every match (~493k docs / 408 MB at last live audit) into memory, then looping with an `await redis.exists` **per document** inside one HTTP handler.
**Why it matters:** Memory and wall-clock scale with the entire backlog rather than the action's scope; the request can OOM or time out the backend as the collection grows. Violates the standing "filter/paginate in the DATABASE" rule.
**Fix:** Add `.limit(1000)` and `.lean()`; batch the Redis existence checks via pipeline instead of one await per doc.
**Verifier:** `cd backend && yarn build` green and the `.limit(` present on that call.
**Eligible for --fix:** yes

### UI-03 · HIGH · ui · impact M / effort L · status: OPEN
**Where:** `frontend/src/components/settings/SignaturesSection.tsx:103-110`
**Claim:** The trash-icon button calls `remove(sig.id)` immediately with no confirmation — the only destructive control in the app skipping the `AlertDialog` pattern used by `RuleCard.tsx:311-343`, `PatternCard.tsx:421-445`, and `BulkRuleDrawer.tsx:462-520`.
**Why it matters:** One misclick loses a configured signature with no undo prompt, against the "never lose stored data" posture.
**Fix:** Wrap the button in an `AlertDialog` mirroring `RuleCard.tsx:311-343`.
**Verifier:** `cd frontend && npx tsc -b` green and an `AlertDialogTrigger` wraps the delete control.
**Eligible for --fix:** yes

### APP-02 · HIGH · app · impact H / effort M · status: OPEN
**Where:** `.github/workflows/ci.yml`
**Claim:** CI builds and tests the **backend only** (`working-directory: backend`). The frontend's `tsc -b && vite build` never runs in CI — yet `deploy.yml` ships `msedb-frontend` to prod on every push to `main`.
**Why it matters:** A frontend TypeScript error or broken build reaches production with nothing gating it.
**Fix:** Add a frontend job to `ci.yml` running `npm ci && npm run build` with `working-directory: frontend`.
**Verifier:** `grep -c "working-directory: frontend" .github/workflows/ci.yml` → 0 now, ≥1 when fixed, plus a green CI run.
**Eligible for --fix:** **no** — CI configuration is on the ENGINE never-auto-fix list. Resolve: apply manually, then re-run `/taudit app`.

### SEC-02 · MEDIUM *(downgraded from HIGH)* · security · impact M / effort L · status: OPEN
**Where:** `backend/src/routes/events.ts:106, 403, 546`
**Claim:** Three handlers resolve `Mailbox.find({ _id: mailboxId })` from a raw query/body param with **no `userId` scope**, unlike every other mailbox lookup in the codebase (`rules/execute.ts:40` does it correctly).
**Why it matters:** An authorization-boundary inconsistency. **Verified blast radius is contained** — the `EmailEvent` filter is `userId`-scoped at `:38/:392/:535`, so a foreign `mailboxId` returns zero events, not another tenant's mail. What does leak is another user's mailbox `email`, used to build Redis folder-cache keys. It is one refactor away from becoming a real cross-tenant leak.
**Fix:** Add `userId` to all three calls.
**Verifier:** `cd backend && yarn build && yarn test` green with zero occurrences of `Mailbox.find({ _id: mailboxId })` in `events.ts`.
**Eligible for --fix:** yes

### SEC-01 · MEDIUM *(downgraded from HIGH)* · security · impact M / effort L · status: OPEN  *(dedup: ARCH-04 is the fuller remedy)*
**Where:** `backend/src/routes/webhooks.ts:47-49`
**Claim:** Public unauthenticated `POST /webhooks/graph` passes attacker-controlled `notification.subscriptionId` into `WebhookSubscription.findOne({subscriptionId})` with no type check, so `{"$ne":null}` is accepted as a query operator.
**Why it matters:** A real NoSQL operator-injection primitive on an unauthenticated route. **Verified not exploitable as written** — the attacker can select an arbitrary subscription, but `sub.clientState !== notification.clientState` at `:58` still gates forgery and they cannot supply the secret. It is a defense-in-depth failure that becomes exploitable the moment that gate is refactored.
**Fix:** Guard `typeof notification.subscriptionId === 'string'` before the lookup. Fuller fix (ARCH-04): a zod `GraphNotificationSchema` `.safeParse()` on each entry of `req.body.value` before enqueueing.
**Verifier:** `cd backend && yarn build && yarn test` green with the type guard present.
**Eligible for --fix:** yes

### ARCH-07 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/mailbox/actions.ts:130-134`
**Claim:** `catch { // Non-critical, log and continue }` — the comment promises a log the code never makes; the error is discarded with zero trace.
**Why it matters:** Contradicts "fail loud, never swallow" in the same breath as its own comment. If `bulkWrite` starts failing, read-state sync to `EmailEvent` stops silently.
**Fix:** Add the `logger.warn` the comment already claims.
**Verifier:** `cd backend && yarn build` green and a `logger.` call inside that catch.
**Eligible for --fix:** yes

### ARCH-08 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/rules/crud.ts:354-356`
**Claim:** `catch { failed++; }` in the per-rule delete loop discards the error; the caller learns "N failed" with no reason.
**Why it matters:** Graph 403 vs Mongo timeout vs already-deleted are indistinguishable in a bulk path where the operator most needs the reason.
**Fix:** Add `logger.warn` with `ruleId` and the error message.
**Verifier:** `cd backend && yarn build` green and a `logger.` call in that catch.
**Eligible for --fix:** yes

### ARCH-05 · LOW · arch · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/events.ts:476`
**Claim:** `(e as any).metadata?.isNewsletter` — the only `as any` in non-test backend source; the field **is** projected at `:434` but Mongoose's dotted `.select()` isn't reflected in the `.lean()` inferred type.
**Why it matters:** Defeats `strict: true` for exactly the field it reads.
**Fix:** Type the `.lean()` call with a small `Pick<>` result type and drop the cast.
**Verifier:** `cd backend && yarn build` green with `grep -c "as any" backend/src/routes/events.ts` → 0.
**Eligible for --fix:** yes

### SEC-05 · LOW · security · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/health.ts:99-106`
**Claim:** Extended diagnostics (mongoHost, queue/subscription/token counts) are gated on `!!req.cookies?.msedb_session || !!req.headers.authorization` — presence, never a verified JWT.
**Why it matters:** Any client can set `Cookie: msedb_session=x` to unlock deployment reconnaissance. No secrets or per-user data, but free profiling.
**Fix:** Use `jwt.verify(token, config.jwtSecret)`, falling back to the minimal payload on failure.
**Verifier:** `cd backend && yarn build && yarn test` green with `jwt.verify` present in `health.ts`.
**Eligible for --fix:** yes

### SEC-07 · LOW · security · impact L / effort L · status: OPEN
**Where:** `backend/src/auth/msalClient.ts:17-26` (`GRAPH_SCOPES`)
**Claim:** `Calendars.ReadWrite` is still requested; a repo-wide case-insensitive grep for "calendar" outside `msalClient.ts` and tests returns zero matches. Open since the 2026-07-06 architecture review (S2).
**Why it matters:** Over-broad consent beyond the documented `Mail.Read`/`Mail.ReadWrite`/`MailboxSettings.ReadWrite` — every mailbox connected since has granted unused calendar **write** access, widening token-compromise blast radius for zero benefit.
**Fix:** Remove `'Calendars.ReadWrite'` from `GRAPH_SCOPES`; existing mailboxes drop it on re-consent.
**Verifier:** `cd backend && yarn build && yarn test` green with zero `Calendars.ReadWrite` in `msalClient.ts`.
**Eligible for --fix:** yes — but it changes the OAuth consent contract; confirm before applying.

### DB-06 · LOW · db · impact L / effort L · status: OPEN
**Where:** `backend/src/models/Mailbox.ts:88-89`
**Claim:** `index({userId:1, email:1}, {unique:true})` is immediately followed by `index({userId:1})` — a strict prefix of the first, already served by MongoDB's prefix rule.
**Why it matters:** Write amplification and storage for zero query benefit.
**Fix:** Delete the standalone `mailboxSchema.index({ userId: 1 });` line.
**Verifier:** `cd backend && yarn build` green with the redundant line gone.
**Eligible for --fix:** yes — **code change only.** Dropping the *existing live* index is a DB mutation requiring `--db-apply`; this finding does not do that.

### UI-01 · MEDIUM · ui · impact M / effort L · status: OPEN
**Where:** `frontend/src/pages/ReportsPage.tsx:87-91,175-179`; `frontend/src/components/contacts/DuplicatesPanel.tsx:469,488,538`
**Claim:** Numeric columns (report counts, contact "Fields" score) use `text-center` on both `TableHead` and `TableCell`, violating the binding rule "all numbers, data AND headers, are right aligned. Always."
**Why it matters:** Harder to scan, and the exact anti-pattern the ui dim's eval contract targets.
**Fix:** Change the 5 numeric head/cell pairs in `ReportsPage.tsx` and the "Fields" pair in `DuplicatesPanel.tsx` to `text-right`. Change **only** numeric-column classes — unrelated `text-center` usage must survive.
**Verifier:** `cd frontend && npx tsc -b` green; numeric columns carry `text-right`.
**Eligible for --fix:** yes

### UI-04 · MEDIUM · ui · impact L / effort L · status: OPEN
**Where:** `frontend/src/components/settings/SignaturesSection.tsx:103-110`
**Claim:** The icon-only `<Trash2>` delete button has no `aria-label`, no `title`, no visible text — screen readers announce an unnamed "button". Its Star/StarOff sibling at `:90-102` at least has a `title`.
**Why it matters:** Accessibility is on the never-simplify-away list; a control with zero accessible name is unusable via assistive tech.
**Fix:** Add `aria-label={`Delete signature "${sig.name}"`}`.
**Verifier:** `cd frontend && npx tsc -b` green with `aria-label` on that button.
**Eligible for --fix:** yes

### REL-05 · MEDIUM · reliability · impact M / effort L · status: OPEN
**Where:** `backend/src/server.ts` (no `unhandledRejection`/`uncaughtException` handler anywhere in `backend/src`)
**Claim:** Only SIGTERM/SIGINT are handled (`:186-187`).
**Why it matters:** Node terminates on an unhandled rejection by default. With no handler, a prod crash leaves no diagnostic beyond "container restarted", and in-flight BullMQ jobs bypass the graceful-shutdown path.
**Fix:** Register `process.on('unhandledRejection', …)` (and optionally `uncaughtException`) logging full context before exit/shutdown.
**Verifier:** `cd backend && yarn build` green with the handler present in `server.ts`.
**Eligible for --fix:** yes

### DB-03 · MEDIUM · db · impact M / effort L · status: OPEN
**Where:** `backend/src/models/AuditLog.ts:12`, `data.md` (## DB change log)
**Claim:** Commit `b17a29d` (today) added the `pattern_unapproved` enum value to `AuditLog.action` — a real shape change, since Mongoose validates enum membership at write time. `data.md`'s change log has one row, dated 2026-08-08, and doesn't mention it.
**Why it matters:** With no migration framework (DB-05), `data.md` is the **only** record of DB change. An unlogged change is invisible to any future audit.
**Fix:** Append a `data.md` change-log row referencing `b17a29d`.
**Verifier:** `grep -q "pattern_unapproved" data.md`
**Eligible for --fix:** yes — but it edits a hand-written doc; attended runs show the diff first.

### APP-07 · LOW · app · impact L / effort L · status: OPEN
**Where:** `RUNBOOK.md:1-51`, `:78-85`
**Claim:** Stale and contradicts the real stack — calls the frontend "Next.js" (actual: Vite + React) and lists `mongo:7`, `redis:7-alpine`, `node:20-alpine` (actual per `docker-compose.yml`/`.nvmrc`: `mongo:8.2`, `redis:8-alpine`, Node 24).
**Why it matters:** `RUNBOOK.md` is the designated first read for `/tbug`, log-analyzer, and docker-debugger — wrong facts send incident diagnosis down the wrong path.
**Fix:** Correct the Docker Images table and frontend description to match `stack.md`.
**Verifier:** `grep -c "Next.js" RUNBOOK.md` → 0 and `grep -c "mongo:7" RUNBOOK.md` → 0.
**Eligible for --fix:** yes — hand-written doc; show diff first.

### APP-08 · LOW · app · impact L / effort L · status: OPEN
**Where:** `.claude/agents/deploy-prod.md:33-34`, `tools/watchdog.sh:14-16`
**Claim:** Both claim the prod watchdog is "not installed yet", but `tools/deploy-live.sh:81-90` installs/refreshes its cron entry on every deploy, and `DEPLOY.md` documents it as live.
**Why it matters:** The `deploy-prod` agent's whole job is accurate deploy-state reporting; it carries an instruction contradicting the working mechanism.
**Fix:** Update both to describe the current state.
**Verifier:** `grep -c "no prod watchdog installed yet" .claude/agents/deploy-prod.md` → 0 and `grep -c "NOT INSTALLED YET" tools/watchdog.sh` → 0.
**Eligible for --fix:** yes — hand-written files; show diff first.

### UI-08 · LOW · ui · impact L / effort L · status: OPEN  *(dims disagree — see note)*
**Where:** `backend/src/routes/health.ts:36`
**Claim:** The standard health path is `/api/v1/health`; this app serves only `/api/health`.
**Why it matters:** Breaks the convention other Per-App-Standard tooling expects.
**Contradiction (kept visible):** the **app** dim scored this PASS-with-note and argued against migrating, since `/tsmoke`, the deploy agents, `DEPLOY.md` and `RUNBOOK.md` all consume `/api/health`. The **ui** dim scored it FAIL. Resolution: add `/api/v1/health` as an **additive alias**, breaking no consumer — which satisfies both readings.
**Fix:** Bind `/api/v1/health` to the same handler alongside the existing route.
**Verifier:** `cd backend && yarn build && yarn test` green with both routes registered.
**Eligible for --fix:** yes

---

## This month

### ARCH-02 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/patterns.ts` (940 lines) — `deleteRulesForPattern` (42-55), `unsilenceSenderForPattern` (299-334), `hasRule` enrichment (96-190), bulk-suppress grouping (491-597)
**Claim:** Fails the depth gate as **shallow, not deep** — whitelist mutation, rule-cascade deletion, and per-mailbox grouping live in the route file, unlike the sibling `patternBulkPlan.ts` the same file already correctly delegates to.
**Why it matters:** Business rules can't be unit-tested without Express; a second consumer would have to import from a route file.
**Fix:** Move `deleteRulesForPattern` + `unsilenceSenderForPattern` into `services/patternRuleSync.ts` as one mechanical, behavior-preserving move.
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/patterns-bulk.test.ts src/routes/__tests__/patterns-hasRule.test.ts` — green before and after.
**Eligible for --fix:** yes

### ARCH-03 · MEDIUM · arch · impact M / effort M · status: OPEN
**Where:** `backend/src/services/ruleEngine.ts` — `matchesConditions` (81-129), `simulateRule` (136-221), `findMatchingMessagesForRule` (238-300)
**Claim:** Sender-email/domain matching is reimplemented three times in one file, each re-deriving "lowercase, split on `@`, support string-or-array". They are **not identical** — `matchesConditions` does exact domain compare where other paths use `endsWith`-style matching.
**Why it matters:** A fix to "what counts as a sender-domain match" in one copy silently doesn't apply to the other two.
**Fix:** Extract `normalizeSenderList()` and `extractDomain()` and use in all three.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/ruleEngine.test.ts` — 12 tests green before and after.
**Eligible for --fix:** yes

### ARCH-06 · MEDIUM · arch · impact M / effort M · status: OPEN  *(open since the mailbox.ts split)*
**Where:** `backend/src/routes/mailbox/*.ts` — 31 occurrences across 9 subrouters
**Claim:** The mailbox-ownership lookup-and-404 is hand-copied 31 times. Explicitly deferred in `docs/large-file-split-plan.md` §2.4 with the right fix already named; no follow-up landed.
**Why it matters:** Changing ownership semantics (e.g. shared mailboxes) means editing 31 sites correctly — a missed one is a **silent authorization gap**, not a loud failure.
**Fix:** Add `mailboxRouter.param('id', loadOwnedMailbox)` in `routes/mailbox/index.ts`, then migrate one subrouter file at a time.
**Verifier:** `cd backend && yarn build && yarn test` green; occurrence count strictly decreases from 31.
**Eligible for --fix:** yes — but 31 sites exceeds a bounded lane; do it incrementally, one subrouter per change.

### ARCH-04 · MEDIUM · arch · impact M / effort M · status: OPEN  *(root cause shared with SEC-01)*
**Where:** `backend/src/routes/webhooks.ts:42-106`, `backend/src/jobs/processors/webhookEvents.ts:16-25`
**Claim:** The public Graph webhook payload is enqueued and later consumed via an unchecked `job.data as {...}` cast — no runtime schema validation before the fields build Mongo queries.
**Why it matters:** The one route accepting unauthenticated external input by design has no validation boundary.
**Fix:** zod `GraphNotificationSchema` + `.safeParse()` per entry, dropping failures with a `logger.warn`.
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/webhooks-validation.test.ts` — absent now; passes once schema + test exist.
**Eligible for --fix:** yes

### REL-04 · MEDIUM · reliability · impact M / effort M · status: OPEN
**Where:** `backend/src/services/actionExecutor.ts:57-231`
**Claim:** `executeActions()` reuses the original `messageId` for every Graph call in the loop, but Graph message IDs are **folder-scoped and change on move**. Any action ordered after a `move`/`delete`/`archive` uses a stale ID.
**Why it matters:** The stale call 404s; the catch at `:220-230` reads that as "user moved/deleted it", logs a *warning*, and `break`s — recording the rule as executed with only the pre-move actions. **A multi-action rule the user approved quietly does less than approved**, and both the audit log and logs describe it as benign rather than MSEDB's own ordering bug.
**Fix:** Capture the new `id` from the move/archive Graph response and use it for subsequent actions.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/actionExecutor.test.ts` — 7 tests green plus a new case asserting the post-move id is used.
**Eligible for --fix:** yes

### DB-04 · MEDIUM · db · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/rules/crud.ts:341`, `:409`; `backend/src/models/StagedEmail.ts:12`
**Claim:** Both rule-delete paths call `Rule.deleteOne` with no cleanup of `StagedEmail` docs whose required `ruleId` still points at the deleted rule.
**Why it matters:** Execution doesn't break today (`stagingProcessor` reads the staged item's own embedded actions), but every delete-with-pending-staged-email creates a stale reference; any future `.populate()` silently yields null. Last live orphan check (2026-08-08) was clean — nothing prevents new ones.
**Fix:** In both handlers, expire (`status:'expired'`) or delete staged emails for that `ruleId`.
**Verifier:** `cd backend && yarn build && yarn test` green plus a test asserting no staged email retains a deleted `ruleId`.
**Eligible for --fix:** yes

### SEC-06 · MEDIUM · security · impact M / effort L · status: OPEN
**Where:** `backend/src/server.ts:52-59` vs limiters at `:76-77`
**Claim:** `healthRouter`, `webhooksRouter`, `trackingRouter` mount **before** the rate limiters, and neither `/webhooks` nor `/track` is ever brought under any limiter — though each request does at least one Mongo read/write.
**Why it matters:** An attacker can drive unlimited Mongo writes via `/track/open/:id.png` (any UUID, no validation it maps to a real tracked email) or unlimited enqueue attempts via `/webhooks/graph`. The documented posture (20/min auth, 100/min api) doesn't mention these have no ceiling at all.
**Fix:** Add a dedicated generous RedisStore-backed limiter to those two mounts, sized so legitimate Graph notification bursts aren't starved.
**Verifier:** `cd backend && yarn build && yarn test` green with a limiter preceding both mounts.
**Eligible for --fix:** yes — but sizing it wrong throttles real Graph traffic in prod; confirm the limit before applying.

### SEC-03 · MEDIUM · security · impact M / effort M · status: OPEN
**Where:** `backend/package-lock.json`, `frontend/package-lock.json`
**Claim:** `npm audit --omit=dev` reports 8 high-severity backend prod advisories (`ws`, `socket.io-parser`, `engine.io`, `lodash`, `path-to-regexp`, `undici`, `brace-expansion`, `ip-address` via `geoip-lite`) and 4 high frontend (`lodash`, `react-router`, `socket.io-parser`, `ws`).
**Why it matters:** `ws`/`socket.io-parser`/`engine.io` sit directly on the live Socket.IO transport used by every connected client — reachable, not theoretical.
**Fix:** `npm audit fix` for non-major bumps in both workspaces; evaluate semver-majors (`ws`, `react-router`, `@azure/msal-node`) individually against the suite.
**Verifier:** `cd backend && npm audit --omit=dev --audit-level=high` exits 0; same in `frontend/`.
**Eligible for --fix:** **no** — dependency changes must be vetted and named before install per the global standard. Resolve: approve the bump list, then apply.

### APP-03 · MEDIUM · app · impact M / effort M · status: OPEN  *(dedup: TEST-08 part, ARCH-BASELINE-04)*
**Where:** `frontend/package.json:9`; no `eslint` dependency; no `eslint.config.*`/`.eslintrc*` anywhere in the repo
**Claim:** No linter is configured **anywhere**. `frontend` declares `"lint": "eslint ."` but eslint is not a dependency and no config exists; backend has no lint script at all. **Verified directly by the orchestrator** — this is not a sandbox artifact.
**Why it matters:** `yarn lint`, documented in the project's own CLAUDE.md, cannot run. The repo's quickstart contains a broken command.
**Fix:** Scaffold ESLint flat config for `frontend/` (and optionally `backend/`), add devDependencies, then triage the first run.
**Verifier:** `cd frontend && yarn lint` exits 0.
**Eligible for --fix:** **no** — a new linter's first run is a large unreviewed diff plus a dependency add. Resolve: approve, then scaffold as its own change.

### PERF-01 · HIGH · perf · impact H / effort M · status: OPEN
**Where:** `backend/src/services/ruleEngine.ts:255-297`
**Claim:** Rule "Run Now" fetches all unread messages from Graph, then filters sender/domain/subject/body **client-side** (4 chained `.filter()` calls at 267/276/286/294) instead of using Graph's `$filter`.
**Why it matters:** A mailbox with thousands of unread messages loads all of them into memory per rule run — memory, network, and latency all scale with backlog rather than matches.
**Fix:** Push senderEmail/senderDomain/subjectContains into the Graph `$filter` query param. (Body matching may have to stay client-side — Graph `$filter` doesn't support body `contains`; say so rather than claiming a full fix.)
**Verifier:** `cd backend && npx vitest run src/services/__tests__/ruleEngine.test.ts` green plus a test asserting `$filter` is sent.
**Eligible for --fix:** **no** — changes Graph query semantics on a live-mail path; needs a deliberate design pass.

### PERF-02 · LOW · perf · impact L / effort M · status: OPEN
**Where:** `backend/src/routes/admin.ts:194-204`
**Claim:** The admin health endpoint loads all `WebhookSubscription` and `Mailbox` documents with no limit.
**Why it matters:** Memory/latency spikes as those collections grow.
**Fix:** Add `.limit(1000)` to both and return pagination metadata.
**Verifier:** `cd backend && yarn build` green with `.limit(` on both queries.
**Eligible for --fix:** yes

### TEST-05 · HIGH · tests · impact H / effort M · status: OPEN
**Where:** `backend/src/middleware/csrf.ts:36-98`
**Claim:** The double-submit CSRF pattern — token issuance, validation, and the exemption list — is entirely untested.
**Why it matters:** A broken exemption exposes the add-in or webhooks to CSRF; the comparison should also be timing-safe. This is a security control with zero regression protection.
**Fix:** Add `backend/src/middleware/__tests__/csrf.test.ts` covering issuance, safe-method pass, missing/mismatched token, and each exemption.
**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/csrf.test.ts`
**Eligible for --fix:** yes

### TEST-06 · MEDIUM · tests · impact M / effort M · status: OPEN
**Where:** `backend/src/middleware/errorHandler.ts`
**Claim:** Error→HTTP mapping is untested.
**Why it matters:** Misconfiguration leaks stack traces to clients or suppresses real errors.
**Fix:** Test AppError status mapping, absence of stack traces in responses, generic 500 fallback, 400 with constraint details.
**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/errorHandler.test.ts`
**Eligible for --fix:** yes

### TEST-07 · MEDIUM · tests · impact M / effort L · status: OPEN
**Where:** `backend/src/middleware/rateLimiter.ts`
**Claim:** Rate limiting is applied at startup but never tested — no proof the documented 20/min and 100/min hold, or that Redis failure degrades gracefully.
**Why it matters:** A deployment regression could silently disable brute-force protection on `/auth`.
**Fix:** Test within-limit pass, over-limit 429, window reset, Redis-failure resilience.
**Verifier:** `cd backend && npx vitest run src/middleware/__tests__/rateLimiter.test.ts`
**Eligible for --fix:** yes

### TEST-09 · MEDIUM · tests · impact M / effort L · status: OPEN
**Where:** `backend/src/auth/__tests__/requireAuth.test.ts:6-20`
**Claim:** `requireAuth` has exactly **one** test (missing token). No coverage for valid, expired, malformed, or wrong-issuer tokens.
**Why it matters:** A token-validation bug could grant access to the wrong user or accept an expired token, and nothing would fail.
**Fix:** Add the four missing cases.
**Verifier:** `cd backend && npx vitest run src/auth/__tests__/requireAuth.test.ts`
**Eligible for --fix:** yes

### TEST-10 · MEDIUM · tests · impact H / effort M · status: OPEN
**Where:** `backend/src/jobs/processors/` — 1 test file across 12 processors
**Claim:** Only `embeddingReconcile` is tested. `webhookEvents`, `stagingProcessor`, and `patternAnalysis` — the steady-state workers — have none.
**Why it matters:** A bug in `webhookEvents` or `stagingProcessor` silently corrupts mailbox state.
**Fix:** Happy-path tests for the three highest-risk processors.
**Verifier:** `cd backend && npx vitest run src/jobs/processors/__tests__/`
**Eligible for --fix:** yes

### APP-09 · MEDIUM · app · impact M / effort L · status: OPEN  *(found at synthesis, not by a dim agent)*
**Where:** `SECURITY.md:30` vs `data.md:49-57`
**Claim:** `SECURITY.md` publicly states **"No Email Content Storage — email content is not persisted beyond what is needed for pattern detection"**, while `data.md` lists "email subjects, bodies, and cached body text" among prod data requiring masking, and `bodyPrefetch`/`EmailEvent` demonstrably cache body content.
**Why it matters:** This is a **published privacy claim** in a public repo that the architecture contradicts. Whichever is wrong, one of them misleads — and `SECURITY.md` is the one outsiders read.
**Fix:** Rewrite the `SECURITY.md` bullet to describe what is actually stored and its retention (EmailEvent 90d TTL, cached bodies), or change the architecture to match the claim.
**Verifier:** `NONE — human judgment` (requires deciding which statement becomes true).
**Eligible for --fix:** no

---

## This quarter

### TEST-01 · CRITICAL · tests · impact H / effort H · status: OPEN
**Where:** `backend/src/services/deltaService.ts`
**Claim:** Incremental Graph email sync — token lifecycle, pagination, 410 handling — has zero tests.
**Why it matters:** Failures to paginate or recover from an expired deltaLink silently skip email batches, breaking pattern detection for hours with no signal.
**Fix:** Test successful paginated delta, 410 → fresh query, missing deltaLink → initial sync, 5xx retry, dedup integration.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/deltaService.test.ts`
**Eligible for --fix:** **no** — `effort: H` exceeds one bounded worker (ENGINE §2). Resolve: re-plan via `/tos`.

### TEST-02 · CRITICAL · tests · impact H / effort H · status: OPEN
**Where:** `backend/src/services/graphClient.ts`
**Claim:** The Graph wrapper (semaphore, retry/backoff, error classification) is mocked in every downstream test and has none of its own.
**Why it matters:** Every Graph operation routes through it; a semaphore deadlock stops the entire backend, and mocks hide exactly that.
**Fix:** Test semaphore acquire/release under concurrency, 429/5xx backoff, immediate failure on 401/403/404, Bearer header construction.
**Verifier:** `cd backend && npx vitest run src/services/__tests__/graphClient.test.ts`
**Eligible for --fix:** **no** — `effort: H`. Resolve: `/tos`.

### TEST-03 · CRITICAL · tests · impact H / effort H · status: OPEN
**Where:** `backend/src/routes/webhooks.ts:20-110`
**Claim:** The only public endpoint — handshake, clientState validation, dedup jobId, fire-and-forget enqueue — is untested.
**Why it matters:** Dedup failure causes duplicate rule execution on the same email (real mailbox actions applied twice); a clientState regression admits spoofed notifications.
**Fix:** Test handshake token echo, clientState mismatch skip, lifecycle enqueue, change-notification dedup jobId, 202-before-enqueue ordering.
**Verifier:** `cd backend && npx vitest run src/routes/__tests__/webhooks.test.ts`
**Eligible for --fix:** **no** — `effort: H`. Resolve: `/tos`. *(Note: the narrow SEC-01 type guard IS eligible and lands this week.)*

### TEST-04 · HIGH · tests · impact H / effort H · status: OPEN
**Where:** `backend/src/auth/routes.ts:20-90`
**Claim:** The whole OAuth login/callback flow is untested.
**Why it matters:** A regression in state validation or token caching locks every user out or misroutes tokens between mailboxes.
**Fix:** Test login redirect + state, callback rejects missing code/state, code exchange, user/mailbox creation, invalid-state rejection.
**Verifier:** `cd backend && npx vitest run src/auth/__tests__/routes.test.ts`
**Eligible for --fix:** **no** — `effort: H`. Resolve: `/tos`.

### TEST-08 · HIGH · tests · impact H / effort H · status: OPEN
**Where:** `frontend/src/` — 153 source files, 0 tests, no test runner
**Claim:** No frontend test infrastructure at all.
**Why it matters:** Auth state, rule/pattern CRUD, and streaming AI search ship with no regression protection.
**Fix:** Install vitest + RTL, then critical-path tests for auth state and the `/patterns` + `/rules` flows. (ESLint half is APP-03.)
**Verifier:** `cd frontend && yarn test`
**Eligible for --fix:** **no** — infrastructure + dependency additions. Resolve: approve the stack, then scaffold.

### APP-04 · HIGH · app · impact M / effort M · status: OPEN  *(dedup: UI-06)*
**Where:** `frontend/src/App.tsx` (no `/sysinfo` route), `frontend/src/components/layout/Topbar.tsx:188-213`
**Claim:** The required SYSINFO page is entirely absent — no route, no component, no menu link.
**Why it matters:** No in-app way to see what's deployed or its drift without shelling into the DGX.
**Fix:** Build `/sysinfo` per `standard-spec.md` §In-app features (reference: `ezvms`).
**Verifier:** `grep -ril "sysinfo" frontend/src --include=*.tsx` non-empty plus the route resolving.
**Eligible for --fix:** **no** — app-code feature, never auto-scaffolded.

### APP-05 · MEDIUM · app · impact L / effort L · status: OPEN  *(dedup: UI-07)*
**Where:** `frontend/src/components/layout/Topbar.tsx:196-212`
**Claim:** The avatar dropdown has no LAYOUT section and no Responsive toggle — only a user label and Logout.
**Why it matters:** Standard affordance missing; also the natural home for the SYSINFO link, so both gaps compound in one menu.
**Fix:** Add a LAYOUT section with the Responsive toggle.
**Verifier:** `grep -c "Responsive" frontend/src/components/layout/Topbar.tsx` ≥ 1.
**Eligible for --fix:** **no** — needs a design decision on where layout state lives.

### APP-06 · MEDIUM · app · impact M / effort H · status: OPEN
**Where:** `frontend/package.json` (`ag-grid-community`, `ag-grid-react`), `frontend/src/components/inbox/InboxDataGrid.tsx`
**Claim:** Grids use the npm `ag-grid-*` packages rather than a vendored copy of `taj3rconnect/prdgrid`; the standard requires "copy, don't link".
**Why it matters:** A core UI primitive depends on an unowned upstream.
**Fix:** Vendor prdgrid and migrate grid usages; drop the ag-grid deps.
**Verifier:** `grep -c '"ag-grid' frontend/package.json` → 0.
**Eligible for --fix:** **no** — `effort: H`, repo-wide migration.

### UI-02 · HIGH · ui · impact M / effort H · status: OPEN  *(open since 2026-08-08)*
**Where:** `frontend/src/components/shared/LoadingSpinner.tsx:1-21`; 24 other files render inline `animate-spin`
**Claim:** The house rule "one shared progress popup with status messages and a Cancel control" is unmet — `LoadingSpinner` is a bare icon with no status text and no Cancel, and 24 of 25 loading states bypass it entirely.
**Why it matters:** Every screen reinvents loading feedback and no long fetch can be cancelled.
**Fix:** Build one `<FetchProgressPopup>`, then migrate call sites largest-first.
**Verifier:** `NONE — human judgment` — button/pending-mutation spinners are a legitimately different use, so no count threshold is a correct pass bar.
**Eligible for --fix:** **no** — component authoring.

### UI-05 · MEDIUM · ui · impact M / effort H · status: OPEN  *(open since 2026-08-08)*
**Where:** `frontend/src/components/ui/select.tsx` used across 15 files (~103 `<Select`); `cmdk` absent
**Claim:** The rule "ALL dropdowns are typeahead searchable" is violated app-wide; no combobox/command primitive exists to build from.
**Why it matters:** High-cardinality pickers (mailbox, folder, category) force scrolling instead of type-to-filter.
**Fix:** Vet and add `cmdk`, build a Combobox wrapper, migrate highest-cardinality selects first.
**Verifier:** `NONE — human judgment` — dependency presence alone doesn't prove migration coverage.
**Eligible for --fix:** **no** — component authoring across many call sites plus a dependency add.

### DB-05 · MEDIUM · db · impact M / effort H · status: OPEN
**Where:** `data.md` (## Migrations)
**Claim:** No migration framework exists — self-documented in `data.md`. No `backend/src/migrations/`, no `migrate-mongo`.
**Why it matters:** The Per-App Standard requires "every DB change = versioned migration + data.md row"; MSEDB has only the second half, and DB-03 shows even that slips.
**Fix:** Adopt `migrate-mongo` or a small in-repo runner — an architecture decision for Taj.
**Verifier:** `NONE — human judgment`
**Eligible for --fix:** no

### DB-01 · MEDIUM · db · impact M / effort M · status: OPEN
**Where:** live `msedb.calendarsyncmaps` (per `docs/msedb-ddl.md:26`, snapshot 2026-08-08); companion candidate `settings`
**Claim:** `calendarsyncmaps` (3 indexes, one unique compound) was still live 4+ months after the calendar feature was removed in `7a95f05` (2026-04-08); zero code references remain today.
**Why it matters:** Unowned, un-retained data (likely attendee emails and subjects) sitting in prod with no TTL and no code path — plus index-maintenance cost on every write to the shared mongod.
**Fix:** Confirm live doc count and last write, archive-dump if non-empty, then the collision-safe rename → watch → drop procedure. Never a direct DROP.
**Verifier:** `NONE — human judgment` (live DB mutation)
**Eligible for --fix:** **no** — DB mutation. Resolve: review, then `/taudit db --fix --db-apply`.

### SEC-04 · MEDIUM · security · impact H / effort — · status: DEFERRED (confirm DGX firewall/Tailscale ACLs block 27020 and 6382 from the public internet; no repo change possible)
**Where:** `docker-compose.yml:64-120`
**Claim:** MongoDB (27020) has no `--auth`/root user configured anywhere in compose — the backend's credentialed URI is never actually enforced by mongod — and Redis (6382) runs passwordless by design. Both bind all interfaces, unlike the frontend's explicitly loopback-bound `127.0.0.1:3011:8081`.
**Why it matters:** Previously documented in `docs/architecture-review.md` S12 as intentional, with the same open question. Graph tokens are now AES-256-GCM encrypted (verified fixed), lowering Mongo's single-point impact — but unauthenticated Redis with BullMQ job payloads remains fully exposed to anything reaching the port. **Given APP-01 proves this repo's infra assumptions are public, confirming this is now urgent.**
**Fix:** Verify at the infra layer that both ports are unreachable from the internet, and record it in `DEPLOY.md`/`RUNBOOK.md` so it stops being rediscovered every audit.
**Verifier:** `NONE — human judgment` (infra-layer, not repo-testable)
**Eligible for --fix:** no

---

## Not doing (and why)

- **STG-001/002/003, ENV-001, GIT-001, DB-PRISMA-000** — accepted deviations recorded in the project's
  CLAUDE.md. Reported as **EXCEPTION**, not GAP, per doctrine.
- **Graph token plaintext storage** (prior review S1) — re-verified as **already fixed**: AES-256-GCM via
  `encryptTokenData`/`decryptTokenData` with a legacy-plaintext read fallback that re-encrypts on write.
- **requireAuth coverage** — every router verified to apply `requireAuth`/`requireAdmin` except the three
  documented public routes. PASS, not a finding.
- **CSRF exemption list** and **CORS allowlist** — both verified correct and narrowly scoped. PASS.
- **BullMQ worker consistency** — all 13 queues share one `defaultJobOptions` and one logging block. PASS.
  (CLAUDE.md's table says 11 queues; the repo has 13 — minor doc drift, folded into APP-07's doc pass.)
- **Frontend/backend `Pattern`/`Rule` type mirroring** — real duplication, but a shared-types package is a
  build-tooling decision, not a bounded fix. Flagged for visibility only.
- **prdgrid migration of individual tables** — subsumed by APP-06 rather than filed per-table.
- **Live DB checks** — 7 db checks (orphan counts, `$indexStats`, storage health, drift) require a live
  `mongosh` session on the DGX. `ssh` is on the HALT LIST, so these are **NOT_EVALUATED**, never PASS.
  Last known-good values (2026-08-08) are cited where relevant, not re-asserted as current.
- **Live UI spot-check and color contrast** — 2 ui checks need a rendered page; no browser was used, so
  every ui finding is source-only evidence and nothing is claimed as runtime-proven.
- **Vault checks (PRT-001, VLT-001)** — no vault access from the dim agent. NOT_EVALUATED.

## Double-counting disclosure

Three defects are scored under two dims each because the check IDs are independently defined:
`SEC-002`/`SEC-CHK-01` (committed credentials), `DOC-007`/`DB-STAB-004` (unverified backup), and
`LINT-001`/`ARCH-BASELINE-04` (no linter). This depresses `pct` slightly versus a fully deduped scoring.
Recorded rather than silently adjusted.
