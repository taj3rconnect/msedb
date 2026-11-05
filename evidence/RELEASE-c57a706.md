# RELEASE c57a706

- when: 2026-08-14T15:21Z · target: https://msedb.aptask.com (DGX) · branch: main
- intended sha: c57a70609891066240be87c6454cd83d3961e0f7
- deployed sha: c57a70609891066240be87c6454cd83d3961e0f7 → **MATCH**
- rollback tag: `deploy-restore-20260814-151524-993f42d` (prod's prior state, 993f42d)
- mechanism: push to main → `.github/workflows/deploy.yml` → DGX self-hosted runner
  → `tools/deploy-live.sh` (run 31813716048, success, 41s)

## Contents

Frontend only — 7 files, +800/-143, zero backend files, no migrations.

- f6e811e  cursor-anchored tooltips above the pointer, on every patterns control
- e660d3e  one-click Delete / Mark read / Archive icons on card hover

## Build

```
frontend: yarn build (tsc -b + vite)   ✓ built in 12.99s        exit 0
backend:  yarn build (tsc)             Done in 11.39s           exit 0
```

## Tests

```
backend: yarn test (vitest)
 Test Files  15 passed (15)
      Tests  98 passed (98)
   Duration  5.63s
                                       exit 0
```

Frontend `yarn lint` NOT run — eslint is not installed in frontend/node_modules
(pre-existing tooling gap, predates this release). Type safety was still gated by
`tsc -b` inside the frontend build.

## Gates

No `.claude/tship.json` in this repo, so there is no declared screen contract or
pixel baseline. Verification below was driven by hand and is correspondingly
shallower than the standard.

```
health:        GET /api/health → HTTP 200  {"status":"healthy","version":"v1.33.01"}
asset change:  index-BjYIMnvX.js (pre)  →  index-CJoKxHDm.js (post)   CHANGED
               (proves a real rebuild, not a cached no-op)
deployed sha:  DGX git rev-parse HEAD == c57a706                       MATCH
containers:    msedb-frontend  Up 50 seconds (healthy)   ← rebuilt
               msedb-backend   Up About an hour (healthy) ← not rebuilt, 0 backend files
               msedb-mongo / msedb-redis  untouched, healthy
```

Live DOM assertions on https://msedb.aptask.com/patterns (authenticated session):

```
elementsWithTooltips:    313
quickRuleIconButtons:     60   (20 cards x 3 icons)
icon aria-labels:        "Create a Delete rule for this pattern"
                         "Create a Mark as read rule for this pattern"
                         "Create a Archive rule for this pattern"   ← grammar bug, see below

tooltip on hover of Approve:
  pointer            513,512
  tip rect           top 376  bottom 494  left 321  right 705
  ABOVE_THE_POINTER  PASS — 18px above the pointer
  NEVER_COVERS_PTR   PASS
  IN_VIEWPORT        PASS
  z-index            2147483000
  pointer-events     none
  position           fixed
```

## Screens

- patterns page, quick-rule icons revealed on card hover:
  `screenshot-1786720828542-1.jpg`
- patterns page, tooltip rendered above the pointer over the Approve button:
  `screenshot-1786720896774-2.jpg`

(Saved under the Claude-in-Chrome screenshot temp dir; no pixel-diff baseline
exists for this repo — see the missing tship.json note above.)

## Known issue shipped

`aria-label="Create a Archive rule for this pattern"` — should read "an Archive".
Cosmetic, screen-reader-only, not worth its own deploy; fold into the next change.

## Also closed by this release

The UNPROVEN UI gate carried on releases 5f50649 and b71688c — the patterns page
has now been driven and screenshotted against live prod.
