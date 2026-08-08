#!/usr/bin/env bash
# deploy-live.sh — deploy the current origin/main to the live DGX checkout.
#
# Runs ON the DGX, two ways:
#   1. GitHub Actions self-hosted runner 'msedb-dgx' (.github/workflows/deploy.yml)
#      — the primary path: a push to main auto-triggers it.
#   2. Manual fallback from a dev machine:
#        ssh dgx 'cd ~/claude/MSEDB && bash tools/deploy-live.sh'
#
# This is the DEPLOY LEG ONLY — it never promotes a branch. /tprod owns promotion
# and the one production confirmation.
set -euo pipefail

export PATH="/usr/bin:/usr/local/bin:/home/admin/.npm-global/bin:$PATH"

DGX_DIR="${DGX_DIR:-/home/admin/claude/MSEDB}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8010/api/health}"
APP_SERVICES="msedb-backend msedb-frontend"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

cd "$DGX_DIR"

# --- Preconditions -----------------------------------------------------------
# .env is gitignored and lives ONLY on the box. Without it the backend starts with
# no Azure AD credentials and no ENCRYPTION_KEY, so every stored Graph token becomes
# undecryptable at runtime. Fail before touching anything.
[ -f .env ] || { echo "::error::$DGX_DIR/.env is missing — refusing to deploy."; exit 1; }

OLD="$(git rev-parse HEAD)"
git fetch origin --prune -q
TARGET="$(git rev-parse "origin/$DEPLOY_BRANCH")"
echo "▶ deploy $DGX_DIR: ${OLD:0:9} → ${TARGET:0:9}  (origin/$DEPLOY_BRANCH)"

# --- Rescue untracked files the incoming tree would clobber -------------------
# The DGX accumulates untracked working notes (AGENTS.md, docs/*.md, scripts/).
# When a later commit starts tracking a path that already exists untracked here,
# `git reset --hard` overwrites it with no warning and the local copy is gone.
# Move any such file aside FIRST so a deploy can never silently eat work.
RESCUE="$HOME/backups/msedb/clobbered-$STAMP"
git ls-tree -r --name-only "$TARGET" > /tmp/msedb-incoming-$$.txt
while IFS= read -r f; do
  if [ -f "$f" ] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    mkdir -p "$RESCUE/$(dirname "$f")"
    mv "$f" "$RESCUE/$f"
    echo "  rescued untracked $f → $RESCUE/$f"
  fi
done < /tmp/msedb-incoming-$$.txt
rm -f /tmp/msedb-incoming-$$.txt

# --- Move the checkout -------------------------------------------------------
# reset --hard, NOT clean: docker-compose.override.yml, .env and the runtime dirs
# are untracked on purpose and must survive every deploy.
git reset --hard "$TARGET"
NEW="$(git rev-parse HEAD)"

# --- Rebuild ONLY the app services -------------------------------------------
# mongo/redis use prebuilt images and hold the data. Never recreate them here, and
# NEVER `down -v` — the mongo volume is shared with JTCRM and -v destroys their data.
echo "  docker compose up -d --build $APP_SERVICES"
# shellcheck disable=SC2086
docker compose up -d --build $APP_SERVICES

# --- Verify, and roll back if the new build is not healthy -------------------
ok=""
for _ in $(seq 1 36); do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || echo 000)"
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 5
done

if [ -z "$ok" ]; then
  echo "::error::health check never returned 200 (last=$code) — rolling back to ${OLD:0:9}"
  git reset --hard "$OLD"
  # shellcheck disable=SC2086
  docker compose up -d --build $APP_SERVICES
  echo "rolled back. Investigate: docker logs msedb-backend"
  exit 1
fi

# --- Install/refresh the prod watchdog (AGT-003) ------------------------------
# Reinstalled on EVERY deploy so a host rebuild or a fresh clone cannot silently
# lose it. Idempotent: the marker comment identifies our line and replaces it.
chmod +x "$DGX_DIR/tools/watchdog.sh"
CRON_MARK="# msedb-watchdog (managed by tools/deploy-live.sh)"
CRON_LINE="*/1 * * * * $DGX_DIR/tools/watchdog.sh >/dev/null 2>&1 $CRON_MARK"
( crontab -l 2>/dev/null | grep -Fv "$CRON_MARK" || true; echo "$CRON_LINE" ) | crontab -
echo "  watchdog cron installed: $(crontab -l | grep -cF "$CRON_MARK") entry"

echo "✅ deployed ${OLD:0:9} → ${NEW:0:9} — health 200, watchdog armed"
