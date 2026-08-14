# RELEASE 2e84a67
- when: 2026-08-14T14:16Z · target: https://msedb.aptask.com · branch: main
- intended sha: 2e84a67 · deployed sha: 2e84a67 → MATCH
- rollback tag: deploy-restore-20260814-101141-53f9910
- source: /taudit --fix 2026-08-13 (26 findings fixed across 8 dimensions)

## Build
```
backend  yarn build (tsc)        → exit 0
frontend npx tsc -b              → exit 0
frontend yarn build (vite prod)  → exit 0, built in 12.22s
```
(frontend build run manually — APP-02 found CI does not build the frontend)

## Tests
```
backend yarn test → exit 0
 Test Files  15 passed (15)
      Tests  98 passed (98)      [baseline before this run: 9 files / 68 tests]
```

## Gates
```
V1 public URL      HTTP 200 in 0.140s (1134B)                    PASS
V2 bundle fresh    index-BxT1nEPq.js -> index-BjYIMnvX.js        PASS
V3 health          {"status":"healthy","version":"v1.33.01"}     PASS
V4 new route       /api/v1/health -> 200 (new in this release)   PASS
V5 sha match       deployed 2e84a67 == intended 2e84a67          PASS
deploy workflow    run 31808470013 conclusion=success            PASS
```

## Screens
login (/ -> /login): msedb-prod-2e84a67-login.png · pixel-diff NO BASELINE (unproven)
Console: 1 error — 401 /auth/me, expected for an anonymous visitor; auth routes untouched this release.

## Coverage NOT achieved (stated, not rounded up)
- No .claude/tship.json → no screen spec; 1 screen checked, unauthenticated.
- Changed UI surfaces (SignaturesSection, ReportsPage, DuplicatesPanel) are behind
  MSAL login and were NOT visually verified this run.
- No pixel baselines exist; diff check UNPROVEN for all screens.
- TEST-11: two pre-existing suites re-implement route logic rather than importing
  handlers, so "98 tests green" protects less than the count suggests.

## Still OPEN after this release
- APP-01 (CRITICAL): TLS key + Cloudflare tunnel credentials tracked in a PUBLIC
  repo, unrotated. Unaffected by this deploy. Rotation first.
