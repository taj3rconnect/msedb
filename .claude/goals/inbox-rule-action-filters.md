# Goal card — inbox rule-action filters + live build stamp

slug: inbox-rule-action-filters
created: 2026-08-25
level: 2 (bounded multi-step build) — run as a SUPERVISED loop, Taj present

## GOAL
The inbox filter row offers four states — Unread / All / Read / Deleted — where
"Read" and "Deleted" show only the emails a RULE marked read or deleted, each
button carrying today's count as a badge; and the sidebar build stamp shows the
real deploy time instead of a frozen 2026-03-16.

## NON-GOALS
- No new right-side panel (Taj chose toolbar counts).
- No backfill of historical actions — filters start empty and fill forward.
- Manual (Taj-initiated) read/delete stay OUT of the new filters.
- No change to the Unread/All semantics that exist today.
- No change to the hand-bumped `version` semver convention; only buildDate
  becomes automatic.

## DECISIONS (Taj, 2026-08-25)
1. Scope        : rule-driven only (`metadata.automatedByRule`).
2. Backfill     : none — start empty, fill forward.
3. Right side   : counts as badges on the filter buttons, no new panel.
4. Version      : auto-stamp in CI (no SHA shown).

## ROOT CAUSE (why this is not just a UI task)
Rule provenance is only half-wired:
- `services/actionExecutor.ts` (AUTOMATIC path) writes NO provenance for
  delete or markRead.
- `routes/rules/execute.ts` (manual run-now) stamps `automatedByRule` on
  delete only; markRead does a bare `$set: { isRead: true }` (line ~157).
So "read per rules" is unanswerable from the data today. Backend provenance
must land before the filters mean anything.

## DESIGN
Stamp provenance on the EXISTING event document — do NOT insert new `read`
events. `GET /api/events` does not filter by eventType, so inserting rows
would duplicate every affected email in the inbox grid.

New optional fields on `IEmailEventMetadata`:
  ruleMarkedReadAt?: Date   ruleMarkedReadBy?: ObjectId(Rule)
  ruleDeletedAt?:    Date   ruleDeletedBy?:    ObjectId(Rule)
Sparse compound indexes on { userId, metadata.ruleMarkedReadAt: -1 } and
{ userId, metadata.ruleDeletedAt: -1 }.

## CONSTRAINTS
- Prod IS the only environment (accepted deviation STG-001..003). Live
  mailboxes, live Graph creds.
- DB change → sparse indexes + a data.md log row. No migration framework
  exists in this project; Mongoose autoIndex is the mechanism.
- Never create a mailbox rule without explicit approval (core UX contract) —
  untouched by this work.
- Never `docker compose down -v` (mongo shared with JTCRM).
- No deploy without Taj's explicit approval.

## VERIFIER (run by tverifier / a non-maker, not by the maker)
  cd backend  && npx tsc --noEmit
  cd backend  && npx vitest run
  cd frontend && npx tsc -b --noEmit
  cd frontend && npx vite build
  bash -n tools/deploy-live.sh
  + new unit test: rule markRead/delete stamps ruleMarkedReadAt/ruleDeletedAt
  + new unit test: GET /api/events?ruleAction=read filters on provenance
  + headless screenshot of /inbox showing 4 filter buttons

## BUDGET
Canonical retry ladder (skills\tverify\SKILL.md § Canonical retry ladder).
Failure = verifier FAIL | non-zero exit | timeout | empty diff.

## HUMAN GATE
Prod deploy only. Taj reads every diff before merge.

## LANE
In place on a feature branch — Taj is present and supervising; no parallel
writer on this tree.

## STATUS (2026-08-25, branch feature/inbox-rule-action-filters)
- [x] W1 build stamp (deploy-live.sh + version.json v1.34.01 + .gitignore)
      stamp snippet proven in isolation; bash -n clean
- [x] W2 provenance (EmailEvent + StagedEmail + actionExecutor +
      rules/execute + stagingManager rescue un-stamp)
- [x] W3 API filter (events.ts ?ruleAction= via extracted
      utils/ruleActionFilter.ts + GET /events/rule-action-counts)
- [x] W4 UI (4-state MAIL_FILTERS + badges + filter-aware empty state)
- [~] W5 verify -- STATIC GATE GREEN, VISUAL GATE OUTSTANDING
      backend tsc 0 | 151 tests / 22 files pass | frontend tsc 0 |
      vite build ok | bash -n ok
      Mutation-checked: stamping the post-move id instead of the arrival id
      makes the new actionExecutor guard FAIL, so it is not a vacuous pass.
      OUTSTANDING: tuiux requires screenshot verification with realistic data.
      MSEDB has ONE environment (prod), so that needs Taj's deploy approval.

## OPEN FINDINGS (not fixed -- out of this task's scope)
1. `yarn lint` is DEAD repo-wide: eslint 10.9.1 finds no `eslint.config.*`
   anywhere in the repo. Pre-existing, not caused by this branch, but it
   means the lint gate in CLAUDE.md currently proves nothing.
2. The new rule-action-counts query auto-fires on inbox load. Consistent with
   the screen's existing auto-fetch, but tuiux's "never auto-run a data fetch
   on view load" rule technically covers it. Two indexed countDocuments.
