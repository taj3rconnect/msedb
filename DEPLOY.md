# MSEDB — Deploy Guide

How to ship code to the DGX and verify it's live. Read `RUNBOOK.md` for service
internals; this file is the deploy procedure only.

## Prod deploy runner (the primary path — 2026-08-08)

**A push to `main` deploys to production automatically.** No hand-run SSH steps.

| Piece | Value |
|---|---|
| Workflow | `.github/workflows/deploy.yml` — `on: push: branches: [main]` + `workflow_dispatch` |
| Runner | self-hosted `msedb-dgx-prod-runner`, labels `[self-hosted, msedb-dgx]`, on the DGX at `~/actions-runner-msedb` |
| Service | `actions.runner.taj3rconnect-msedb.msedb-dgx-prod-runner.service` |
| Deploy script | `tools/deploy-live.sh` (runs ON the box; fetch → `reset --hard origin/main` → rebuild app containers → health-gate → rollback on failure) |
| Watchdog | `tools/watchdog.sh`, cron `*/1 * * * *`, **installed/refreshed by every deploy** |
| Watch a run | `gh run list --workflow=deploy.yml` · `gh run watch <id>` |
| Re-deploy current main | `gh workflow run deploy.yml` |

What the script guarantees: it refuses to start if `.env` is missing; it rebuilds
**only** `msedb-backend` + `msedb-frontend` (mongo/redis keep running, and it never
uses `down -v`); it polls `/api/health` for up to 3 minutes and **rolls back to the
previous SHA and rebuilds** if the new build never returns 200; and it moves any
untracked DGX file that the incoming tree would clobber into
`~/backups/msedb/clobbered-<timestamp>/` instead of destroying it.

**Manual fallback** (documented beside the runner, not instead of it):

```bash
ssh dgx 'cd ~/claude/MSEDB && bash tools/deploy-live.sh'
```

## Environment facts (don't guess these)

| Thing | Value |
|-------|-------|
| Server | **DGX** — `ssh dgx` (Tailscale 100.119.177.14, user `admin`) |
| Repo on DGX | `/home/admin/claude/MSEDB` — already has `backend/` + `frontend/` `node_modules` |
| Local dev repo | `D:\claude\msedb` |
| Build location | **On the DGX, inside Docker.** There is no local Docker daemon by default — do NOT try to build/deploy locally. |
| Backend health | `GET /api/health` → 200  (NOT `/health` — that 404s) |
| Public URL | https://msedb.aptask.com (cloudflared tunnel) |
| Host ports | frontend **3010**, backend **8010**, mongo **27020** (⚠ shared w/ JTCRM), redis **6382** |

## Safety rules

- **NEVER `docker compose down -v`** — the mongo volume is shared with JTCRM; `-v` destroys their data too.
- **Rebuild only the changed services:** `docker compose up -d --build msedb-backend msedb-frontend`. This leaves the shared mongo/redis and the tunnel running. A bare `up -d --build` is usually fine too (mongo/redis use prebuilt images and won't rebuild), but targeting the two app services is the safe default.
- **The DGX has a locally-modified `docker-compose.yml`** (DGX-specific config) that is NOT in git `main`. Do **not** `git checkout` / `git stash` / `git reset` over the DGX working tree blindly — you'll wipe that config. See "Current caveat" below.

---

## Standard deploy (once the DGX tree is clean — see caveat)

```bash
ssh dgx
cd ~/claude/MSEDB
git pull origin <branch>
# fast pre-build verification using the DGX node_modules:
( cd backend  && npm run build )            # tsc — must exit 0
( cd frontend && npx tsc -b )               # typecheck — must exit 0
# build + recreate just the app containers:
docker compose up -d --build msedb-backend msedb-frontend
# verify:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8010/api/health   # expect 200
docker ps --format '{{.Names}}\t{{.Status}}' | grep msedb                    # all "healthy"
curl -s -o /dev/null -w '%{http_code}\n' https://msedb.aptask.com            # expect 200
```

---

## ~~Current caveat — DGX tree is dirty + behind~~ (STALE as of 2026-08-08)

> **This caveat is largely obsolete.** Re-checked on 2026-08-08: the DGX's only
> modification to `docker-compose.yml` is the Redis AOF flag added that day (now
> in git), and the DGX-specific image pins were long since extracted into an
> untracked `docker-compose.override.yml`, which survives a `reset --hard`.
> The patch-based deploy below is **no longer the method** — use the runner above.
>
> What IS still true: the DGX carries untracked working files (`AGENTS.md`,
> `docs/*.md`, `scripts/`, `.env.bak-*`). `tools/deploy-live.sh` now rescues any of
> those that a commit starts tracking, rather than letting `reset --hard` eat them.
>
> Original text preserved below for history.

### Original caveat (as of 2026-06-24)

The DGX repo is at commit `219d565` with **uncommitted changes that ARE the PR #5
work** (Graph rate-limit fix / email-body Redis cache / 429 backoff — developed on
the DGX, merged to `main` from local, never pulled back). It also has a
**DGX-specific `docker-compose.yml`** not in `main`. So you **cannot** `git pull`
cleanly yet.

Until the tree is reconciled, deploy a feature by **applying only its diff** on top
of the DGX tree (safe only when your changed files don't overlap the DGX's dirty
files — `git apply --check` enforces this).

### Patch-based deploy (the method used for `feature/rules-forward`)

```bash
# --- Local (D:\claude\msedb) ---
git add <your changed files> && git commit -m "feat: ..."
git push -u origin <feature-branch>                 # optional but recommended
git diff <BASE>..HEAD > /tmp/feature.patch          # BASE = commit the DGX shares (e.g. 22af89e)
scp /tmp/feature.patch dgx:/tmp/feature.patch

# --- DGX ---
ssh dgx
cd ~/claude/MSEDB
git apply --check /tmp/feature.patch                # MUST pass — refuses on any overlap/conflict
git apply /tmp/feature.patch
( cd backend  && npm run build )                    # tsc 0
( cd backend  && npx vitest run <changed test> )    # tests green
( cd frontend && npx tsc -b )                        # typecheck 0
docker compose up -d --build msedb-backend msedb-frontend
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8010/api/health    # 200
docker ps --format '{{.Names}}\t{{.Status}}' | grep msedb
```

To roll back a patch deploy before rebuild: `git apply -R /tmp/feature.patch`.

### Recommended one-time cleanup (makes future deploys a plain `git pull`)

1. Preserve the DGX's `docker-compose.yml` (commit it to the repo if its changes are
   real, or move env-only bits to `.env`).
2. The PR #5-equivalent dirty changes are already in `main@22af89e`, so they can be
   dropped: `git stash` them, then `git checkout main && git pull origin main`
   (re-apply the compose config afterward). Verify the running app is unchanged, then
   future deploys become the **Standard deploy** above.

---

## Notes

- Pre-build `npm run build` / `tsc -b` on the DGX host is verification only (compiles
  to `dist/` / typechecks) — it does NOT run the app. Never run `vite dev` / `node`
  as the served process; the app always runs in Docker.
- A green build is not proof the deploy took — always finish with the `curl /api/health`
  + `docker ps` + public-URL checks above.
