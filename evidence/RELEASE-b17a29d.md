# RELEASE b17a29d

- when: 2026-08-13T21:06–21:12Z · target: https://msedb.aptask.com (DGX) · branch: main
- intended sha: b17a29d94cfdbf43a9a9ef7fa6aa307e3bd3b93a
- deployed sha: b17a29d94cfdbf43a9a9ef7fa6aa307e3bd3b93a → **MATCH**
- rollback point: tag `deploy-restore-20260813-170530-433f107`
- workflow run: 31744096139 (Deploy (DGX), success, 49s)

## Scope

Approved patterns became editable: action pill on every card, per-card
Delete / Mark read / Other / Unapprove, and a bulk drawer spanning all statuses.

## Build

```
backend  yarn test  → Test Files 9 passed (9) · Tests 68 passed (68)
backend  yarn build → tsc, Done in 9.88s
frontend yarn build → tsc -b && vite build, built in 12.54s
```

`yarn lint` was NOT run: this repo declares the script but has no eslint
config or dependency (pre-existing gap, not introduced here). `tsc -b` is the
real typecheck and passed.

## Gates

No `.claude/tship.json` in this repo, so the tship verify gate could not run —
verification below is correspondingly shallower and was done by hand.

```
public GET /                 → 200
GET /api/health              → {"status":"healthy","version":"v1.33.01"}
bundle  pre  index-KNGl_CPr.js
        post index-BxT1nEPq.js          → fresh build served
deployed sha (ssh dgx, git rev-parse HEAD) == intended sha
login: MS SSO completed from existing session (no credentials entered)
```

## Screens

- patterns /patterns?status=approved: every card shows a solid green action pill
  ("Delete") plus footer `Rule does: [Delete] [Mark read] [Other] [Unapprove]`;
  201 patterns matching filters.
  screenshot-1786655453290-0.jpg
- patterns suggested view: dashed-outline action pill on unapproved cards
  (Delete / Mark read), footer unchanged (Approve / Reject / Customize).
- bulk drawer: Status + Outcome columns present; with action=Delete every
  already-Delete row reads "No change"; toggling to Mark as read flips the same
  rows to "Rule replaced".
  screenshot-1786655483277-1.jpg · screenshot-1786655532568-2.png

No pixel-diff baselines exist for this project, so screens were verified by
inspection, not by diff.

## Known gap — write paths not exercised on prod

Unapprove, per-card retarget, and bulk apply are covered by unit tests
(`classifyBulkTarget`, 68/68) but were NOT clicked on live data: each one
deletes and rebuilds a real mailbox rule. Read paths and rendering are proven;
the mutations are proven only at unit level.
