#!/usr/bin/env bash
# MSEDB prod watchdog (Per-App Standard AGT-003).
#
# Runs every minute from cron on the DGX. Probes the backend health endpoint,
# writes an alive file (mtime < 60s == up), appends to an activity log, and
# raises an ALERT file that an operator checks FIRST during an incident.
#
# Self-healing policy (deliberately narrow):
#   - msedb-frontend  -> stateless Nginx, safe to restart automatically.
#   - msedb-backend   -> holds BullMQ workers and in-flight Graph calls: ALERT ONLY.
#   - msedb-mongo     -> SHARED WITH JTCRM. Never touched. ALERT ONLY.
#   - msedb-redis     -> queue state. ALERT ONLY.
#
# NOT INSTALLED YET. See docs/tauditall-2026-08-08.md — the prod deploy must
# install/refresh the cron entry so a host rebuild cannot silently lose it:
#   */1 * * * * /home/admin/claude/MSEDB/tools/watchdog.sh >/dev/null 2>&1

set -uo pipefail

HEALTH_URL="${MSEDB_HEALTH_URL:-http://localhost:8010/api/health}"
STATE_DIR="${MSEDB_WATCHDOG_DIR:-/var/tmp/msedb-watchdog}"
ALIVE_FILE="$STATE_DIR/alive"
ALERT_FILE="$STATE_DIR/ALERT"
LOG_FILE="$STATE_DIR/watchdog.log"
COMPOSE_DIR="${MSEDB_COMPOSE_DIR:-/home/admin/claude/MSEDB}"
TIMEOUT_SECS=10

mkdir -p "$STATE_DIR"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s %s\n' "$(ts)" "$1" >>"$LOG_FILE"; }

alert() {
  printf '%s %s\n' "$(ts)" "$1" >>"$ALERT_FILE"
  log "ALERT: $1"
}

code=$(curl -s -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)

if [ "$code" = "200" ]; then
  touch "$ALIVE_FILE"
  # Clear a stale alert once the service is demonstrably healthy again.
  if [ -f "$ALERT_FILE" ]; then
    log "recovered (HTTP 200) - clearing ALERT"
    rm -f "$ALERT_FILE"
  fi
  exit 0
fi

log "health probe failed: HTTP $code from $HEALTH_URL"

# Identify which containers are actually down before deciding what to do.
down=$(docker ps -a --filter 'name=msedb-' --format '{{.Names}} {{.State}}' 2>/dev/null \
       | awk '$2 != "running" { print $1 }' | tr '\n' ' ')

if [ -n "${down// /}" ]; then
  log "containers not running: $down"
fi

case " $down " in
  *" msedb-mongo "*|*" msedb-redis "*)
    alert "datastore container down ($down) - NOT auto-restarted (mongo is shared with JTCRM). Manual action required."
    exit 1
    ;;
esac

if [ "$code" = "503" ]; then
  alert "backend reports degraded (HTTP 503) - a dependency check is failing. Not auto-restarting a stateful worker host. Check: docker logs msedb-backend"
  exit 1
fi

case " $down " in
  *" msedb-backend "*)
    alert "msedb-backend is not running - NOT auto-restarted (BullMQ workers / in-flight Graph calls). Check: docker logs msedb-backend"
    exit 1
    ;;
esac

# Only the stateless frontend is self-healed.
case " $down " in
  *" msedb-frontend "*)
    log "self-heal: restarting stateless msedb-frontend"
    if (cd "$COMPOSE_DIR" && docker compose restart msedb-frontend >>"$LOG_FILE" 2>&1); then
      sleep 5
      recheck=$(curl -s -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)
      if [ "$recheck" = "200" ]; then
        touch "$ALIVE_FILE"
        log "self-heal succeeded"
        exit 0
      fi
      alert "self-heal restarted msedb-frontend but health is still HTTP $recheck"
    else
      alert "self-heal restart of msedb-frontend FAILED"
    fi
    exit 1
    ;;
esac

alert "health endpoint unreachable (HTTP $code) but all msedb containers report running - investigate the tunnel, nginx, or the backend process itself"
exit 1
