# RELEASE a6cab10

- when: 2026-08-25 16:25–16:32 UTC · target: https://msedb.aptask.com · branch: main
- intended sha: a6cab1080369f60506f55179dcf75fe2d9acdf11
- deployed sha: a6cab1080369f60506f55179dcf75fe2d9acdf11 → **MATCH**
- previous sha: 4ba678d (rollback tag `deploy-restore-20260825-121300-4ba678d`)
- mechanism: push-to-main → `.github/workflows/deploy.yml` → DGX self-hosted runner →
  `tools/deploy-live.sh` (run 32871843817, success in 55s)

## Shipped

`feat(inbox)`: sender-rule aware clear-rules icon (orange + R/D badge) and
immediate mark-read on preview. 7 files, +279 / −19. No migrations.

## Build

```
backend  tsc --noEmit   → exit 0
frontend tsc -b         → exit 0
frontend vite build     → exit 0 (built in 13.14s)
```

## Tests

```
backend vitest run → Test Files 20 passed (20) · Tests 133 passed (133)
  incl. NEW src/utils/__tests__/senderRuleActions.test.ts → 8 passed
```

## Gates

```
HTTP     https://msedb.aptask.com/          → 200 in 0.12s, 1134B
Marker   "<title>MSEDB - Microsoft Email Dashboard</title>" + id="root"  → FOUND
Health   GET /api/health → 200 {"status":"healthy","version":"v1.33.01"}
Bundle   pre-deploy  index-CpiaHoa0.js
         post-deploy index-B5rNjRSv.js      → CHANGED (real rebuild, not a no-op)
Containers  msedb-frontend / msedb-backend / msedb-mongo / msedb-redis  → all healthy
```

Deployed-code presence (the auth wall blocks a logged-in UI walk, so code presence
was asserted directly against what prod serves):

```
GET /assets/InboxPage-CHy5Uu4m.js (200, 1268982B) contains:
  "click to remove all"   FOUND
  "Rules for this sender" FOUND
  "text-orange-500"       FOUND
  "Mark read"             FOUND
  "senderRuleActions"     FOUND
  /},\s*3000\)/           GONE  (old 3s mark-read timer removed)

docker exec msedb-backend:
  dist/utils/senderRuleActions.js  present (2486B, built 16:25 this deploy)
  dist/routes/events.js            references senderRuleActions + collation
```

Runtime proof of the new Mongo query against prod data (read-only):

```
sample sender in rules: hi@mail.theresanaiforthat.com
$in [UPPERCASED] WITH collation(en,2)  → 2 rules   (case-insensitive works)
$in [UPPERCASED] WITHOUT collation     → 0 rules   (expected)
total rules in prod: 3619
cost, 50-sender page: WITH 11ms / WITHOUT 1ms · docsExamined=3553 execMs=9
```

No MongoServerError, no collation error, no /api/events 5xx in backend logs post-deploy.

## Screens

login: `msedb-a6cab10-login.png` — renders, redirects to Microsoft sign-in as expected.
Console: 1 error, `401 /auth/me` — the normal logged-out probe, not a regression.

## Known gaps (stated, not hidden)

1. **The inbox badge has not been seen.** MSAL auth blocks a headless logged-in walk, and
   MSEDB has no staging tier (STG-001). Orange/green state, the R/D superscript placement
   at 8px, and the tooltip were verified as *code present in the served bundle*, never as
   *pixels*. Taj must eyeball the inbox.
2. **No `.claude/tship.json`** — this repo has no gate spec, so no screen walk, no
   `expect`/`absent` assertions and no pixel-diff baselines. Coverage is shallower than
   the ladder intends.
3. **Collation cost** — the sender-rule query cannot use the
   `{userId, conditions.senderEmail}` index (collation mismatch), so it scans that user's
   ~3.5k rule keys per inbox page: +10ms. Acceptable now; the durable fix is a stored
   lowercase `conditions.senderEmailLower` field with a plain index.

VERDICT: PASS on every check that could run · badge appearance UNPROVEN (auth wall).
