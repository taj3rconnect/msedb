# RELEASE 406fbc3

- when: 2026-08-25T18:09:20Z · target: https://msedb.aptask.com · branch: main
- intended sha: 492f168 (merged as 406fbc3) · deployed sha: 406fbc354 → **MATCH**
- rollback tag: `deploy-restore-20260825-140652-6c1e066`
- workflow run: 32882082600 (Deploy (DGX)) — conclusion: success
- previous prod sha: 6c1e066

## What shipped
1. Inbox filter row gains **Read** / **Deleted**, scoped to what a RULE did, each
   badged with the count for the selected date window.
2. Sidebar build stamp now reflects the real deploy instead of a frozen date.

Root cause behind (1): rule provenance was never recorded. `actionExecutor`
(the automatic path) wrote none at all, and no path stamped rule-driven reads --
both did a bare `$set: { isRead: true }`. "What did my rules do today" was
unanswerable from the data until this release.

## Build
backend  npx tsc --noEmit      → exit 0
backend  npx vitest run        → 151 passed / 22 files
frontend npx tsc -b            → exit 0
frontend npx vite build        → ✓ built
tools    bash -n deploy-live.sh → exit 0

## Tests
151 passed (22 files). 18 of them new this release:
- utils/ruleActionFilter.test.ts   (7) date-window transfer onto action time
- utils/ruleActionStamp.test.ts    (7) stamp payloads + rescue un-stamp + failure path
- services/actionExecutor.test.ts  (4 added) provenance + arrival-id guard

MUTATION-CHECKED (not a vacuous pass): changing the markRead stamp to use the
post-move id instead of the arrival id makes
"stamps with the ARRIVAL id even after a move reassigned the id" FAIL.
Restored after the check.

## Gates
NOTE: this repo has NO .claude/tship.json, so there is no gate config and
verification is shallower than the standard calls for. Ran directly instead:

V1 health      curl /api/health → {"status":"healthy","version":"v1.34.01"}   PASS
V2 fresh build asset hash index-B5rNjRSv.js → index-C6DYUDMu.js (changed)     PASS
V3 sha match   deployed 406fbc354 == intended                                  PASS
V4 auth        existing session loaded /dashboard and /inbox                   PASS
V5 console     0 errors on /inbox (1 non-blocking warning)                     PASS
V6 stamp       deploy log: "stamped version.json: v1.34.01 @ 2026-08-25T18:09:20.000Z"
               then COPY version.json into BOTH images                         PASS

## Screens
inbox-filters (realistic data, 97 emails): msedb-406fbc3-inbox-filters.png
  - top-left reads "v1.34.01 / 08-25-26--2:09 PM" (was v1.33.01 / 2026-03-16)
  - filter row: Unread | All | Read 0 | Deleted 0, badges render, no clipping
inbox-deleted-empty: msedb-406fbc3-inbox-deleted-empty.png
  - "No rule-deleted emails / No rules have deleted emails in this period."
  - empty, NOT an error (tuiux: empty tables show zero rows, never an error)

No pixel-diff baseline exists for these screens (no tship.json), so the
screenshots are evidence, not a regression diff.

## Expected state on day one
Read/Deleted both show 0. That is correct, not a bug: provenance is recorded
going FORWARD by decision (no backfill), so the counts populate as rules fire.

## DB
EmailEvent.metadata +4 optional fields; StagedEmail +1 optional field; 2 SPARSE
indexes on emailevents (~493k docs) built by Mongoose autoIndex at backend
start. Additive and backward-compatible. Logged in data.md.

## Known gaps (not introduced by this release)
- `yarn lint` is dead repo-wide: eslint 10.9.1 finds no `eslint.config.*`
  anywhere; the repo is still on the pre-v9 .eslintrc format. The lint gate in
  CLAUDE.md currently proves nothing.
- No .claude/tship.json, so /tsmoke cannot walk declared screens and there are
  no pixel baselines.
