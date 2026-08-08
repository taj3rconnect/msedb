# data.md — MSEDB data, environments, and change log

Scaffolded by `/tappaudit --fix` on 2026-08-08. The `## DB change log` below is
append-only and **every** schema or data change gets a row — no exceptions.

## Engine

**MongoDB 8.2** (`mongo:8.2`, container `msedb-mongo`, database `msedb`),
accessed through **Mongoose 8.23** from `backend/src/models/`.

> ⚠ **Shared mongod.** Host port **27020** serves BOTH `msedb` and JTCRM's
> `dailylog_db`. Never run a volume-level destructive operation
> (`docker compose down -v`, volume prune) — it destroys JTCRM's data too.

Secondary stores: **Redis 8** (`msedb-redis`) for BullMQ queues, sessions and
caches — rebuildable, not a system of record. **Qdrant** (AX1's shared instance,
port 6333) for email embeddings — derived data, rebuildable via the
`email-embedding` queue.

## Migrations

**None. There is no migration framework in this project.** Mongoose applies
schema shape at write time; collection changes today happen implicitly when a
model file changes.

This is an open gap against the Per-App Standard ("every DB change = a versioned
migration + a `data.md` log row"). Until a migration runner is adopted, the
change log below is the *only* record — keep it accurate.

- The global Prisma rule targets **SQL** databases and does not apply to MongoDB.
- Candidate runners for Mongo: `migrate-mongo`, or a small in-repo
  `backend/src/migrations/` runner invoked at startup.

## Environments

| Env | Host | Database | Credentials |
|---|---|---|---|
| Prod | DGX (`/home/admin/claude/MSEDB`) | `msedb` on `msedb-mongo:27017` (host 27020) | `.env` on the DGX |
| Staging | **does not exist** | — | — |
| Local dev | not run locally (no local Docker daemon by default — see `DEPLOY.md`) | — | — |

## Sync direction

**prod → staging only. NEVER staging → prod, never prod ← anything.**

No staging tier exists today, so no sync is configured. When one is created, a
prod → staging copy must be an **authorized, minimized, sanitized** snapshot:

MSEDB stores real mailbox content. Before any snapshot leaves prod, the following
must be masked, synthesized, or excluded:

- email subjects, bodies, and cached body text
- sender/recipient addresses and display names
- contacts records
- MS Graph OAuth tokens (`encryptedTokens` on `User`) — **exclude entirely**
- audit log rows containing addresses
- Qdrant vectors derived from message text — regenerate, never copy

Separate DB credentials per environment are required. Record the sanitization
procedure here, plus evidence it ran, on the first sync.

## Seed command

**TODO** — none exists. MSEDB bootstraps from live Microsoft Graph data after an
OAuth login; there is no seed fixture.

## Safe reset command

Drop only MSEDB's own database — never the volume, never the container:

```bash
ssh dgx
docker exec msedb-mongo mongosh msedb --eval 'db.dropDatabase()'
docker compose restart msedb-backend
```

> Confirm with the data owner first. This destroys every detected pattern,
> approved rule, staged email and audit row for every user.

## DB change log

Append-only. Every schema or data change — including manual/ad-hoc edits — gets a
row.

| Date | Change | Migration/ref | Why |
|---|---|---|---|
| 2026-08-08 | Log created (no historical entries reconstructed) | `/tappaudit --fix` | Per-App Standard DOC-010 |

_No schema change has been made by an audit run. `/tdbaudit` on 2026-08-08 was
read-only — see the audit notes below._

## Audit notes — what `/tdbaudit` learned (2026-08-08)

Live facts confirmed against the prod DB (read-only):

- Engine is **MongoDB 8.2.7, standalone** — `mongod --bind_ip_all`, **no replica
  set**. Consequences that shape every future fix run:
  - **No oplog** → `mongodump --oplog` is unavailable → **no point-in-time
    recovery**, and no consistent snapshot across collections under write load.
  - No failover. A single container is the whole database.
- Scale: 14 collections, ~493k documents, 408 MB data, 86 MB indexes, 54 indexes.
- **Referential integrity is clean** — zero orphaned documents across
  `emailevents`, `patterns`, `rules`, `mailboxes`, `auditlogs`, `trackedemails`,
  `stagedemails`, `webhooksubscriptions` (checked against `users._id`).
- **No unused indexes** — every index shows `$indexStats` ops > 0. Caveat: index
  stats reset on the 2026-08-08 13:13 container restart, so this reflects hours,
  not a full workload cycle.
- An **audit mechanism already exists** (`auditlogs`, 142,730 docs, 6 indexes,
  180-day TTL). Any future audit work must EXTEND this, never install a parallel
  design.
- TTL indexes are already in place on `auditlogs`, `emailevents`, `notifications`,
  `scheduledemails`, `stagedemails` — retention is enforced DB-side.

Fix categories for THIS project:

- **Auto-safe: none.** The only database MSEDB has is production, and the shared
  mongod also serves JTCRM. Every mutation here is a manual, gated operation —
  a `/tdbaudit --fix` run cannot legitimately mutate anything until a non-prod
  environment exists.
- **Manual/gated:** orphan-collection disposition, any index change, and the
  adoption of a migration framework.
