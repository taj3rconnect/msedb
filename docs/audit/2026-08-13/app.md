# app dim — /taudit report — 2026-08-13

Repo root: `D:\claude\msedb` (branch `audit/2026-08-13`, read-only run)
App-type: **web** (Next.js/Vite web app + Express API; no Electron/Tauri/native-GUI signals)
standard_version: 2026.07 (per project CLAUDE.md)
Accepted deviations honored (reported EXCEPTION, not GAP): STG-001/002/003, ENV-001, GIT-001, DB-PRISMA-000.

## Findings

### APP-01 · CRITICAL · app · impact H / effort M · status: OPEN
**Where:** `certs/selfsigned.key:1`, `.cloudflared/cert.pem:1`, `.cloudflared/acdd721a-a650-44c3-824f-6ff106899581.json:1`
**Claim:** Live key material is still tracked in git — `certs/selfsigned.key` contains a `BEGIN PRIVATE KEY` block, `.cloudflared/cert.pem` contains an account-level Cloudflare Argo tunnel token, and the tunnel-credentials JSON holds the TunnelSecret for tunnel `acdd721a`. This was already identified as `SEC-002` in the 2026-08-08 audit (`docs/tauditall-2026-08-08.md`) and deferred pending rotation — it remains unresolved today; `.gitignore` was updated but the files were never untracked or rotated.
**Why it matters:** The Argo tunnel token is account-wide and can create/manage Cloudflare tunnels; the TLS private key is what nginx serves with. Both are exposed to anyone with repo/clone access, and `.gitignore` does nothing to un-expose material already in git history.
**Fix:** Out-of-band: revoke/rotate the Argo tunnel token in the Cloudflare dashboard, regenerate `certs/selfsigned.{crt,key}`, decide how the DGX receives the new cert (bind-mount vs deploy-time generation), then `git rm --cached` the three files (coordinated, needs explicit approval) and consider a history rewrite.
**Verifier:** `git ls-files -- certs/selfsigned.key .cloudflared/cert.pem .cloudflared/acdd721a-a650-44c3-824f-6ff106899581.json` — currently lists all 3 files (fails); passes (empty output) once rotated and untracked.
**Eligible for --fix:** no

### APP-02 · HIGH · app · impact H / effort M · status: OPEN
**Where:** `.github/workflows/ci.yml`
**Claim:** The CI workflow (`ci.yml`) only checks out and builds/tests the **backend** (`working-directory: backend`, `npm run build`, `npm test`). There is no frontend job — `frontend`'s `tsc -b && vite build` and any test/lint step never run in CI, on any PR or push to develop/main.
**Why it matters:** `deploy.yml` rebuilds and ships `msedb-frontend` on every push to `main`, but nothing gates that a frontend build even compiles before it deploys — a broken frontend TypeScript error or build failure can reach production undetected by CI.
**Fix:** Add a second job (or steps) in `ci.yml` with `working-directory: frontend`, running `npm ci`, `npm run build` (which includes `tsc -b`), at minimum.
**Verifier:** `grep -c "working-directory: frontend" .github/workflows/ci.yml` — currently `0` (fails); passes once a frontend build step exists and a CI run is green.
**Eligible for --fix:** yes

### APP-03 · MEDIUM · app · impact M / effort M · status: OPEN
**Where:** `frontend/package.json:9` (`"lint": "eslint ."`), `frontend/package.json` devDependencies (no `eslint` entry), repo-wide (no `eslint.config.*`/`.eslintrc*` anywhere)
**Claim:** No linter is configured anywhere in the repo. `frontend/package.json` declares a `lint` script that invokes `eslint .`, but `eslint` is not even listed as a dependency, and there is no ESLint config file for either `backend/` or `frontend/`. The backend has no lint script at all.
**Why it matters:** `yarn lint` (documented in the project's own `CLAUDE.md`) cannot run — the command in the repo's own quickstart is broken. LINT-001 requires a configured AND passing linter; this repo has neither.
**Fix:** Scaffold an ESLint (flat config) setup for `frontend/` (and optionally `backend/`), add `eslint` + relevant plugins as devDependencies, then run and fix or triage findings. Per doctrine this is a Manual follow-up, not an auto-fix (a new linter's first run is an unreviewed diff).
**Verifier:** `test -f frontend/eslint.config.js -o -f frontend/eslint.config.mjs -o -f frontend/.eslintrc.json -o -f frontend/.eslintrc.cjs` — currently fails (no file); passes once a config exists and `cd frontend && npm run lint` exits 0.
**Eligible for --fix:** no

### APP-04 · HIGH · app · impact M / effort M · status: OPEN
**Where:** `frontend/src/components/layout/Topbar.tsx:188-213`, `frontend/src/App.tsx` (no `/sysinfo` route)
**Claim:** The required SYSINFO page (`/sysinfo`) does not exist anywhere in the frontend — no route, no page component, and no link in the avatar dropdown menu. `Topbar.tsx`'s `DropdownMenu` contains only a user-info label and a Logout item.
**Why it matters:** SYSINFO is a required in-app feature (live dependency versions, drift KPIs, admin Upgrade/Restart) that every app on this standard must ship; its total absence means there is no in-app way to see what's actually deployed or its drift from latest.
**Fix:** Build a `/sysinfo` route + page per `standard-spec.md` §In-app features (1), reference implementation `taj3rconnect/ezvms` `apps/web/app/sysinfo/page.tsx` + `/api/v1/sysinfo`. Add the link to the avatar dropdown's LAYOUT section. App code — flagged, never auto-scaffolded.
**Verifier:** `grep -ril "sysinfo" frontend/src --include="*.tsx"` — currently empty (fails); passes once a SYSINFO page exists.
**Eligible for --fix:** no

### APP-05 · MEDIUM · app · impact L / effort L · status: OPEN
**Where:** `frontend/src/components/layout/Topbar.tsx:196-212`
**Claim:** The required "Responsive toggle" in the avatar/user dropdown's LAYOUT section is missing — the dropdown has only a label and Logout item, no LAYOUT section at all.
**Why it matters:** Standard UX affordance (pulse/ezvms pattern) for previewing responsive layout is absent; also the natural home for the SYSINFO link (APP-04), so both gaps compound in the same missing menu section.
**Fix:** Add a LAYOUT section to the `DropdownMenuContent` in `Topbar.tsx` with a Responsive toggle control.
**Verifier:** `grep -c "Responsive" frontend/src/components/layout/Topbar.tsx` — currently `0` (fails); passes once added.
**Eligible for --fix:** no

### APP-06 · MEDIUM · app · impact M / effort H · status: OPEN
**Where:** `frontend/package.json` (`ag-grid-community`, `ag-grid-react` dependencies), `frontend/src/components/inbox/InboxDataGrid.tsx`
**Claim:** Data tables/grids (e.g. the inbox grid) are built on the npm packages `ag-grid-community`/`ag-grid-react`, not on a vendored copy of `taj3rconnect/prdgrid`. The standard requires "copy, don't link" — no submodule, no package dependency, no remote link back.
**Why it matters:** Violates the vendoring policy this standard exists to enforce (avoiding an unowned, un-auditable upstream dependency for a core UI primitive used across every table in the app).
**Fix:** Vendor a copy of `taj3rconnect/prdgrid` into the repo and migrate `InboxDataGrid.tsx` and other grid usages onto it; remove the `ag-grid-*` npm dependencies. Architecture-level app code — never auto-scaffolded.
**Verifier:** `grep -c '"ag-grid' frontend/package.json` — currently `2` (fails); `0` once migrated off the npm package.
**Eligible for --fix:** no

### APP-07 · LOW · app · impact L / effort L · status: OPEN
**Where:** `RUNBOOK.md:78-85` (Docker Images table), `RUNBOOK.md:1-51` (frontend described as "Next.js")
**Claim:** `RUNBOOK.md` is stale and contradicts the actual stack: it says the frontend is "Next.js served by nginx" (actual: Vite + React per `CLAUDE.md`/`stack.md`), and its Docker Images table lists `mongo:7`, `redis:7-alpine`, `node:20-alpine` (actual, per `docker-compose.yml`/`stack.md`/`.nvmrc`: `mongo:8.2`, `redis:8-alpine`, Node 24).
**Why it matters:** `RUNBOOK.md` is the doctrine-designated first read for `/tbug`, log-analyzer, and docker-debugger when diagnosing an incident — wrong framework/image facts here can send a debugging session down the wrong path.
**Fix:** Update `RUNBOOK.md`'s "Docker Images" table and frontend description to match `stack.md` (the source of truth, itself lockfile-derived).
**Verifier:** `grep -c "Next.js" RUNBOOK.md; grep -c "mongo:7" RUNBOOK.md` — currently `1` and `1` (fails); both `0` once corrected.
**Eligible for --fix:** yes

### APP-08 · LOW · app · impact L / effort L · status: OPEN
**Where:** `.claude/agents/deploy-prod.md:33-34`, `tools/watchdog.sh:14-16`
**Claim:** Both files still state the prod watchdog is "not installed yet" (`deploy-prod.md`: "There is no prod watchdog installed yet (open AGT-003 gap)"; `watchdog.sh` header: "NOT INSTALLED YET"). But `tools/deploy-live.sh` (last modified 2026-08-08 15:11, after `deploy-prod.md`'s 13:18) already installs/refreshes the watchdog cron entry on every deploy (confirmed at `tools/deploy-live.sh:81-90`), and `DEPLOY.md` documents it as live and deploy-installed.
**Why it matters:** The `deploy-prod` agent (whose whole job is to verify and report deploy state accurately) carries an instruction that contradicts the actual, working mechanism — it could cause the agent (or a human) to under-report monitoring coverage or skip verifying the watchdog is actually alive.
**Fix:** Remove/update the stale "not installed" language in both files to match the current, working state (cron installed by `tools/deploy-live.sh`).
**Verifier:** `grep -c "no prod watchdog installed yet" .claude/agents/deploy-prod.md; grep -c "NOT INSTALLED YET" tools/watchdog.sh` — currently `1` and `1` (fails); both `0` once corrected.
**Eligible for --fix:** yes

## Not doing (and why)

- **PRT-001 (vault port registry) / VLT-001 (Obsidian 01-Projects note)** — this agent has no vault access; reported `NOT_EVALUATED`, not PASS.
- **STG-001..003, ENV-001** — accepted deviations (CLAUDE.md: MSEDB has no staging tier and does not need one) → EXCEPTION, not GAP.
- **GIT-001** — accepted deviation (no `develop`-branch working flow; `develop` still exists on origin, untouched) → EXCEPTION.
- **DB-PRISMA-000 / CDR-001 (Prisma)** — accepted deviation (MongoDB via Mongoose; Prisma rule targets SQL) → EXCEPTION.
- **CDR-003 (DB change logging / migration framework)** — already thoroughly self-documented as an open gap inside `data.md` itself (no migration framework exists; change log has only a bootstrap row). Scored FAIL in `checks.csv` for honesty, but no new finding block was written since `data.md` already names the gap, the remediation path, and the reasoning — nothing new to add.
- **backup.md (DOC-007)** — same treatment: `backup.md` already carries an explicit "Status: NOT VERIFIED" banner and a TODO'd destination/cadence/restore-test. Scored FAIL in `checks.csv`; no duplicate finding written.
- **Health endpoint route naming** (`/api/health` vs. the spec's `/api/v1/health`) — functionally complete (real Mongo/Redis checks, sanitized output, auth-gated detail), just a naming deviation used consistently across every doc in this repo. Noted in `checks.csv` as PASS-with-note rather than a finding; not worth a migration that would break every existing consumer (`/tsmoke`, deploy agents, `DEPLOY.md`, `RUNBOOK.md`) for a naming convention alone.
- **CDR-002 (DRY)** — no exhaustive duplication scan was run (advisory, only-if-noticed per doctrine); nothing duplicative was noticed incidentally during this pass. `NOT_EVALUATED`.

## Checks

```csv
check_id,dim,status,score,max,note
GIT-001,app,PASS,2,2,main/develop present; develop unused by design (EXCEPTION GIT-001)
DOC-001,app,PASS,1,1,README.md present
DOC-002,app,PASS,1,1,CLAUDE.md present
DOC-003,app,PASS,1,1,MEMORY.md present
DOC-004,app,PASS,1,1,AGENTS.md present (thin pointer, correct per spec)
DOC-005,app,PASS,2,2,DEPLOY.md present; runner+watchdog+rollback documented
DOC-006,app,PASS,1,1,design.md present
DOC-007,app,FAIL,0,3,backup.md exists but restore never verified -- at best PARTIAL per spec
DOC-008,app,PASS,1,1,stack.md present and lockfile-derived
DOC-009,app,FAIL,0,2,RUNBOOK.md stale vs actual stack -- see APP-07
DOC-010,app,PASS,1,1,data.md present and thorough
DOC-011,app,PASS,1,1,CLAUDE.md is command-rich with pointers
STG-001,app,PASS,1,1,EXCEPTION -- accepted deviation, no staging tier
STG-002,app,PASS,1,1,EXCEPTION -- accepted deviation, no staging tier
STG-003,app,PASS,1,1,EXCEPTION -- accepted deviation, no staging tier
SEC-001,app,PASS,3,3,git check-ignore confirms .env* ignored, .env.example tracked
SEC-002,app,FAIL,0,5,committed key material still tracked -- see APP-01 (known, deferred)
SEC-003,app,PASS,2,2,settings.local.json untracked; cert/key globs in .gitignore going forward
CI-001,app,FAIL,0,3,ci.yml gates backend only; frontend build/test never run in CI -- see APP-02
LINT-001,app,FAIL,0,2,no eslint config anywhere; frontend lint script references uninstalled eslint -- see APP-03
SKL-001,app,PASS,1,1,.claude/,.claude/agents/,.claude/commands/,docs/,docs/adr/,wireframes/ all present
AGT-001,app,PASS,2,2,deploy-prod.md present, Skill tool declared, delegates to /tprod
AGT-002,app,PASS,5,5,git-triggered runner (deploy.yml + self-hosted msedb-dgx-prod-runner + tools/deploy-live.sh) confirmed real and previously proven by a push-triggered deploy
AGT-003,app,PASS,3,3,tools/deploy-live.sh installs/refreshes watchdog cron every deploy; doc staleness noted separately -- see APP-08
APP-001,app,FAIL,0,3,SYSINFO page/route entirely absent -- see APP-04
APP-002,app,FAIL,0,2,Responsive toggle absent from avatar menu -- see APP-05
APP-003,app,PASS,2,2,health endpoint functional with real Mongo/Redis checks and auth-gated detail; route name deviates from /api/v1/health convention (noted, not scored as fail)
APP-005,app,FAIL,0,2,tables built on npm ag-grid package, not vendored prdgrid -- see APP-06
APP-006,app,PASS,1,1,own favicon.svg + Logo.tsx component present, not framework default
CDR-001,app,PASS,1,1,TS-only confirmed; Mongo/Mongoose is EXCEPTION DB-PRISMA-000
CDR-002,app,NOT_EVALUATED,,1,advisory -- no exhaustive DRY scan run this pass
CDR-003,app,FAIL,0,2,no migration framework; change log has only a bootstrap row (self-documented in data.md)
OPS-001,app,PASS,1,1,dev/build/test script verbs present; container names msedb-* match convention (advisory)
ENV-001,app,PASS,3,3,EXCEPTION -- no staging tier exists, so no outbound side-effect surface to contain
OBS-001,app,PASS,1,1,winston structured logging present; health endpoint sanitizes host info before returning it (advisory)
PRT-001,app,NOT_EVALUATED,,1,no vault access from this agent
VLT-001,app,NOT_EVALUATED,,1,no vault access from this agent
NST-001,app,PASS,1,1,single CLAUDE.md at root; nothing to prune
```
