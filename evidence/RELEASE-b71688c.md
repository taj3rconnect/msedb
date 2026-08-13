# RELEASE b71688c

- when: 2026-08-13T20:29Z · target: https://msedb.aptask.com · branch: main
- intended sha: b71688c (feature commit d1055c6) · deployed sha: b71688c → **MATCH**
- rollback point: tag `deploy-restore-20260813-1615-5f50649`
- previous release: 5f50649 (bulk rule drawer + sender typeahead)

## Shipped

`feat(patterns): "Never suggest" — permanently silence a sender`

- `POST /api/patterns/bulk-suppress` — whitelists the senders behind selected
  patterns (exact address or whole domain) and marks those patterns rejected.
- `loadWhitelistMatcher()` — loads a mailbox's whitelist once per analysis run
  and returns a sync predicate, avoiding an N+1 against `isWhitelisted()`.
- `patternEngine.upsertPattern()` now consults that predicate. This closed a
  real gap: `ruleEngine` already refused to act on whitelisted senders, but the
  pattern engine never checked, so a whitelisted sender was re-detected and
  re-suggested on every run, forever.
- Bulk drawer gains a "Never suggest" footer action with a confirm dialog
  listing the exact values and a sender/domain scope toggle.

Non-destructive: existing rules are not deleted. They go inert via ruleEngine's
own whitelist check.

## Build

```
backend  yarn build (tsc)            Done in 7.69s          exit 0
frontend yarn build (tsc -b + vite)  built in 10.42s        exit 0
```

## Tests

```
Test Files  9 passed (9)
Tests      66 passed (66)
  src/services/__tests__/whitelistMatcher.test.ts (11 tests)  NEW
  src/routes/__tests__/patterns-bulk.test.ts      (10 tests)
  src/services/__tests__/patternEngine.test.ts    (18 tests)
```

## Gates (/tsmoke — no .claude/tship.json in this repo, so shallower than a configured gate)

```
HTTP   200 in 0.159s (1134B)                              PASS
Health {"status":"healthy","version":"v1.33.01"}          PASS
Marker "MSEDB - Microsoft Email Dashboard"                PASS
Bundle index-BEEDVuc_.js -> index-KNGl_CPr.js  (changed)  PASS
SHA    origin/main b71688c == DGX b71688c                 PASS
Parity trees identical, ancestry OK                       PASS
Containers  msedb-{frontend,backend,redis,mongo} healthy  PASS
```

Deployed-artifact checks (not inferred from the SHA):

```
msedb-backend  dist/routes/patterns.js      'bulk-suppress'        x2
msedb-backend  dist/services/patternEngine  'loadWhitelistMatcher' x2, 'isSuppressed' x5
PatternsPage-BQwkaWUj.js  'Never suggest', 'exact address', 'whole domain'
usePatterns-CvYAm66M.js   'bulk-suppress', 'bulk-approve', 'patterns/suggest'
```

## Live behavioral verification — suppression actually suppresses

Reversible test on mailbox `taj@jobtalk.ai` (699559ba24c75ebab2b0c553).
Target: `office365alerts@microsoft.com`, pattern 69a5f5cb7b7becf99718f422.

```
1. CONTROL   job 635, no whitelist
             -> 327 sender patterns analyzed; target lastAnalyzedAt = 20:26:59.849Z

2. WHITELIST office365alerts@microsoft.com added to mailbox whitelist

3. TEST      job 636, whitelist in place
             -> 327 sender patterns analyzed
             -> target  lastAnalyzedAt = 20:26:59.849Z  (UNCHANGED - skipped)
             -> others  lastAnalyzedAt = 20:28:03.4xxZ  (refreshed)
             VERDICT: PASS

4. REVERT    whitelist entry removed; whitelists back to senders=[] domains=[]

5. RESTORE   job 637, no whitelist
             -> target lastAnalyzedAt = 20:28:43.824Z (re-detected again)
             confirms suppression is driven solely by the whitelist and is
             fully reversible
```

Side effect, disclosed: the three on-demand analysis runs detected new patterns
(1021 -> 1328 total). That is the scheduled job doing its normal work, triggered
early. No rules were created, no mailbox contents were touched, and the mailbox
whitelist was returned to empty.

## Screens

UNPROVEN. The authenticated UI walkthrough of the bulk drawer was not performed:
/patterns redirects to /login in headless Chromium, and signing in with the
owner's Microsoft 365 credentials is out of scope for an agent. No baseline
screenshots exist for this project, so no pixel-diff was possible.

What this means: the backend behavior is verified end-to-end against live data;
the drawer's rendering and click-path are verified only insofar as the code is
present in the served bundle.
