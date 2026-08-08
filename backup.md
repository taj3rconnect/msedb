# backup.md — MSEDB backup & restore

**Single source for ALL backup matters.** Every backup task or question starts by
reading this file. Scaffolded by `/tappaudit --fix` on 2026-08-08 — the `TODO`
rows below are unanswered and must be filled in by a human.

> ⚠ **Status: NOT VERIFIED.** No restore test has ever been recorded for this
> project. Per the Per-App Standard a backup with no verified restore test is at
> best PARTIAL — treat MSEDB as **unprotected** until the first restore test in
> the log below.

## What to back up

| Scope | Location | Notes |
|---|---|---|
| MongoDB `msedb` database | container `msedb-mongo` (host port **27020**), named volume `msedb-mongo-data` | ⚠ **Shared instance** — the same mongod also serves JTCRM's `dailylog_db`. Back up the `msedb` **database**, not the whole volume, unless you intend to capture JTCRM too. |
| Redis | container `msedb-redis`, volume `msedb-redis-data` | AOF-enabled queue/cache state. Rebuildable — BullMQ jobs are replayable; low backup priority. |
| App config | `.env` on the DGX (`/home/admin/claude/MSEDB/.env`) | **Not in git** (correctly). Holds Azure AD client secret, JWT/session secrets, `ENCRYPTION_KEY`. **Losing `ENCRYPTION_KEY` makes every stored MS Graph token undecryptable.** Back it up to the password manager, never to the repo. |
| TLS / tunnel material | `certs/`, `/etc/cloudflared/config.yml` | See `SECURITY.md` and the open SEC-002 finding — some of this is currently committed to git and must be rotated. |
| Qdrant vectors | AX1's shared Qdrant (port 6333) | **Owned by AX1, not by MSEDB.** Rebuildable from MongoDB via the `email-embedding` queue. |

DDL snapshot: `docs/msedb-ddl.md` (canonical in-repo copy) — intended offsite
destination `dgx:~/backups/msedb/msedb-ddl.md`, **not yet provisioned**.
Regenerated read-only by `/tdbaudit` on every run.

## Destination

- **TODO** — no backup destination is configured. Decide and record: DGX local
  path, offsite target, and a failure-domain-separated copy.
- **TODO** — encryption at rest for the backup artifacts.
- **TODO** — access owner (who can read/restore).

## Backup command

**TODO — none configured.** Reference shape once a destination exists:

```bash
ssh dgx
docker exec msedb-mongo mongodump --db msedb --archive=/tmp/msedb-$(date +%F).archive --gzip
docker cp msedb-mongo:/tmp/msedb-$(date +%F).archive <DESTINATION>
docker exec msedb-mongo rm -f /tmp/msedb-$(date +%F).archive
```

## Restore command

**TODO — never exercised.** Reference shape:

```bash
# Restore into a SCRATCH database first and diff — never straight over msedb.
docker cp <ARCHIVE> msedb-mongo:/tmp/restore.archive
docker exec msedb-mongo mongorestore --archive=/tmp/restore.archive --gzip \
  --nsFrom 'msedb.*' --nsTo 'msedb_restoretest.*'
```

> **NEVER** `docker compose down -v` — the mongo volume is shared with JTCRM and
> `-v` destroys their data too.

## Schedule & retention

| Field | Value |
|---|---|
| Cadence | **TODO** |
| Retention | **TODO** |
| Offsite copy | **TODO** |
| RPO / RTO | **TODO** (optional) |
| Last restore test | **NEVER** |
| Restore-test cadence | **TODO** (recommend quarterly) |

## Backup log

Append-only. Every backup that runs adds a row.

| Date | Scope | Destination | Result |
|---|---|---|---|
| 2026-08-08 | DDL snapshot (schema only, no data) | `docs/msedb-ddl.md` | OK |

> No **data** backup has ever been recorded. The row above is a schema-only
> snapshot — it is not a backup of the database contents.
