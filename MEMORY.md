# MEMORY.md — MSEDB session learnings

Durable, non-obvious things learned while working on MSEDB. Not a changelog (that
is `CHANGELOG.md`) and not architecture (that is `CLAUDE.md`). One bullet per
learning, newest section last.

## Infrastructure

- The MongoDB on host port **27020 is shared with JTCRM** (`dailylog_db`). Any
  volume-level destructive op wipes another product's data. `docker compose
  down -v` is banned in this repo for that reason.
- Qdrant is **not ours** — it is AX1's instance, loopback-bound on the DGX and
  reachable only container-to-container over the external `ax1_default` network.
  The backend joins that network in `docker-compose.yml`.
- The per-project `msedb-tunnel` container was retired; tunnel routes were merged
  into the **host** cloudflared tunnel (`587fd4ea`, config at
  `/etc/cloudflared/config.yml`, systemd-read — not the home-dir config).
- Redis runs **without auth by design**. `REDIS_PASSWORD` is unused; adding a
  password to the container without changing the backend breaks the connection.

## Build & test

- The logger resolves a log directory at import time, so the test suite needs
  `LOG_DIR` set to run outside the container — CI sets it on every step.
- `addin/` and `desktop/` are **separate builds** outside Docker. The add-in must
  be rebuilt before it appears in the frontend Nginx container (bind-mounted from
  `addin/dist`).

## Open items surfaced by audits

- 2026-08-08 `/tauditall`: committed credentials found in git history
  (`.cloudflared/`, `certs/selfsigned.key`) — see `SECURITY.md` and the punch-list
  at `docs/tauditall-2026-08-08.md`. Rotation is the first action, not
  `.gitignore`.
- 2026-08-08: no linter is configured anywhere despite `frontend/package.json`
  declaring a `lint` script; eslint is not even a dependency.
