# RELEASE db30818

- when: 2026-08-18T19:29Z · target: https://msedb.aptask.com (DGX) · branch: main
- intended sha: db3081822b65efabf4fa07eb7280949999ff4d14
- deployed sha: db3081822b65efabf4fa07eb7280949999ff4d14 → **MATCH**
- rollback tag: `deploy-restore-20260818-1500-c57a706` (prod's prior state, c57a706) — created
  retroactively; see Process note below.
- mechanism: push to main → `.github/workflows/deploy.yml` → DGX self-hosted runner
  → `tools/deploy-live.sh` (run 32176795812, success, 1m7s)

## Process note (read before the next release)

This release was authorized via `/tdev` then `/tprod` in direct sequence, at Taj's explicit
instruction ("run tdev and then tprod, do not stop"). Because this repo's prod deploy is
push-to-deploy CI (not a manual promote step), `/tdev`'s push to `main` in Step 6 **was** the
prod trigger — the deploy fired automatically before `/tprod`'s own confirmation gate ever
ran. `/tprod`'s job here was therefore verification (§5b/§5c) and cleanup (Phase 3), not
promotion — there was no separate "push to prod" action left to gate. This was disclosed to
Taj in real time (the tdev deploy-targets block flagged prod as already auto-deployed,
unverified, before `/tprod` was invoked) rather than silently treated as already-approved.

One consequence: the rollback tag (§3b) that's normally cut *before* the push happened
after the fact instead, since the push had already occurred. Created it retroactively
against `c57a706` (prod's actual pre-deploy state, still fully resolvable in history — no
tag was lost, it just didn't exist yet at the moment it would normally be cut).

## Contents

14 fixes from a `/tqa --fix` run against prod (MSEDB has no staging tier) — see
`docs/qa/2026-08-18-e2707e0/REPORT.md` for full detail on every finding, verdict, and fix.

Security/correctness (backend):
- AUTH-01/AUTH-02 — deleted-user JWT and stale-role bypass in `requireAuth`
- RULE-03 — `PUT /api/rules/:id` never synced edits to the Graph inbox rule
- L2-001/WH-01 — unbounded webhook batch -> Mongo query amplification
- WH-03/WH-06 — webhook redelivery dedup + subscription status/expiry gating
- L2-002 — tracking pixel trusted spoofable IP headers
- L2-003/HEALTH-01 — JWT algorithm pinning + deleted/deactivated user check on `/api/health`
- CSRF-01 — Bearer-header CSRF skip reachable with a session cookie present
- NS-01/NS-03 — unvalidated `mailboxId`/`senderEmail` reaching Mongo queries
- ERR-01 — malformed JSON/oversized body mapped to 500 instead of 400/413
- ACT-01 — rule stats over-counted a 404 short-circuit as a processed email
- ACT-02 — interim guard against re-sending an already-succeeded forward action on a
  BullMQ retry (full idempotency ledger deferred — needs a schema change)
- L2-004 — rate-limiter fail-open/closed posture made explicit (no behavior change)

Frontend:
- `PatternCard.tsx` aria-label grammar fix (a/an article agreement) — closes the exact
  "Create a Archive rule" known issue documented in `evidence/RELEASE-c57a706.md`

Repo hygiene:
- `.gitignore` — stop tracking `.claude/troute-runs.md`, formalize `.taudit/` and
  `.playwright-mcp/` ignores

## Build

```
backend:  npm run build (tsc)              exit 0
frontend: npm run build (tsc -b + vite)    built in 13.70s, exit 0
```

## Tests

```
backend: npx vitest run
 Test Files  19 passed (19)
      Tests  125 passed (125)
                                            exit 0

backend: npx tsc --noEmit                  exit 0
frontend: npx tsc -b --noEmit              exit 0
```

Every one of the 12 original fixes independently re-verified by a separate `tverifier`
agent (non-maker) — PASS on all 12, confirmed each test exercises the actual guarded code
path rather than passing vacuously. Full grading table in
`docs/qa/2026-08-18-e2707e0/REPORT.md`.

Frontend `yarn lint` NOT run — no ESLint config exists in this repo (pre-existing gap,
predates this release; left deliberately deferred, see REPORT.md carry-over). Type safety
still gated by `tsc -b`.

## Gates

No `.claude/tship.json` in this repo, so there is no declared screen contract or pixel
baseline — `/tsmoke` ran with a single-URL fallback check (unauthenticated landing page
only; no screens spec to walk authenticated pages).

```
health:        GET https://msedb.aptask.com/api/health -> HTTP 200
               {"status":"healthy","version":"v1.33.01"}
deployed sha:  DGX git rev-parse HEAD == db3081822b65...     MATCH
containers:    msedb-backend   Recreated, Healthy (rebuilt)
               msedb-frontend  Recreated, Healthy (rebuilt)
               msedb-mongo / msedb-redis  untouched, healthy
watchdog:      cron installed (1 entry) -- refreshed by this deploy
```

`/tsmoke` result:

```
HTTP: 200 in 0.245s (1134B)                              PASS
Health: /api/health -> 200                                PASS
Marker: "MSEDB - Microsoft Email Dashboard" found         PASS
Screen (1, no tship.json spec -- unauthenticated landing only):
  renders full page (not blank), title matches, Sign-in
  button present, 1 console error (401 on /auth/me --
  expected for an anonymous visit, not a defect)          PASS
VERDICT: PASS
```

Other network activity observed during the check (all benign, pre-existing, unrelated to
this release's changes): a third-party feedback-widget fetch that aborted once then
succeeded, normal socket.io long-poll transport churn, and Cloudflare's own RUM analytics
beacon being cancelled by navigation.

## Screens

- `docs/qa/2026-08-18-e2707e0/screens/tsmoke-msedb-prod-db30818.png` -- unauthenticated
  landing/login page, full render, post-deploy.

(No pixel-diff baseline exists for this repo -- see the missing tship.json note above.)

## Known issue closed by this release

`aria-label="Create a Archive rule for this pattern"` (shipped in `c57a706`, documented as
a known cosmetic issue in `evidence/RELEASE-c57a706.md`) now reads "Create an Archive rule"
-- fixed via a general a/an article-agreement helper, correct for any future action label.
