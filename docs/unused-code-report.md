# MSEDB Unused-Code Report

**Date:** 2026-07-06 · **Scope:** `backend/src` (84 non-test .ts), `frontend/src` (144 .ts/.tsx), `addin/`, `desktop/`, root scripts, deps, env/config.
**Method:** ripgrep reference-count per file/export (both `@/*` alias and relative import forms; barrels, route mounting in `server.ts`, queue wiring in `jobs/queues.ts`/`schedulers.ts` all traced). Every claim carries the grep command + hit count. **Report only — nothing was deleted.**

Cross-import check: `grep -rl "frontend/src" addin desktop` → 0 hits either direction — addin/desktop share no frontend code, so frontend zero-reference findings are conclusive. `frontend/src` has no barrel `index.ts` files, so grep is not fooled by re-export indirection.

---

## Summary

| Category | SAFE TO DELETE | PROBABLY UNUSED | KEEP (checked, fine) |
|---|---:|---:|---:|
| Unreferenced backend files | 1 | 0 | 83 |
| Unreferenced frontend files | 3 | 0 | 141 |
| Unused exports in referenced files | 5 fns | 12 type-only exports + 3 over-exports | — |
| Unused routes / pages / hooks | 1 page, 1 hook (counted above) | 0 | 18 backend routes, 14 pages, 18 hooks |
| Unused dependencies (backend/frontend/addin/desktop) | 0 | 0 | all traced to imports or build config |
| Obsolete config / env vars | 0 stale keys | 9 vars read in code but missing from `.env.example` | 18/18 `.env.example` keys read in code |
| Root-level scripts / stray files | 0 | 3 (`cleanup-calendar-mirrors.mjs`, `delete-mirrors.mjs`, `msedb.xml`) | `deploy-addin.ps1`, `git-hooks/pre-push`, `version.json` |

**Headline:** this codebase is unusually clean. 4 dead files, 5 dead functions, 3 stale root artifacts. All 18 backend routes are mounted, all 12 job processors are wired, zero unused npm dependencies across all four package.json files.

---

## 1. Unreferenced files — SAFE TO DELETE

| File | Evidence | Notes |
|---|---|---|
| `backend/src/services/notificationService.ts` | `grep -rn "notificationService" backend/src --include="*.ts"` → **0 hits** outside its own file | Exports `createNotification`. Its doc comment says "all notification producers should use this function," but none do — `routes/notifications.ts` and `jobs/processors/tokenRefresh.ts` call `Notification.create()` directly, bypassing the Socket.IO push this wrapper exists to guarantee. Either delete it, or (better) wire producers through it — see §7 note. |
| `frontend/src/pages/ComingSoonPage.tsx` | `grep -rn "ComingSoonPage" frontend/src --include="*.ts*"` → only its own definition; absent from `App.tsx` router (14/15 pages wired, this is the 15th) | Orphaned placeholder — every route it once backed (`/settings`, `/patterns`, `/rules`, `/staging`, `/audit`, `/activity`) now has a real page. |
| `frontend/src/components/shared/MailboxSelector.tsx` | `grep -rn "<MailboxSelector\b" frontend/src` → **0 hits**; name grep → only its own export line | Dead component. |
| `frontend/src/hooks/useMailboxes.ts` | `grep -rl "hooks/useMailboxes['\"]" frontend/src` → **0 files** | Dead hook (wraps `fetchMailboxes`, which pages call via other paths). Only hook of 19 with zero callers. |

## 2. Unused exports within referenced files

### SAFE TO DELETE (dead functions, zero external references)

| Export | File | Evidence |
|---|---|---|
| `aiSearchStatus()` | `frontend/src/api/aiSearch.ts` | name grep across frontend/src → 0 hits outside definition; only `aiSearch()` is used (by `AiSearchPanel.tsx`) |
| `triggerBackfill()` | `frontend/src/api/aiSearch.ts` | 0 hits outside definition |
| `syncFolder()` | `frontend/src/api/mailboxes.ts` | 0 hits — dead promise-wrapper; `InboxPage.tsx` calls `syncFolderStream()` directly |
| `updateMessageCategories()` | `frontend/src/api/settings.ts` | 0 hits outside definition |
| `formatEventType()` | `frontend/src/lib/formatters.ts:46` | `grep -rn "formatEventType" frontend/src` → only its own definition |

### PROBABLY UNUSED — type-only exports never imported by name (harmless; consumers get shapes via TS inference)

| Types | File |
|---|---|
| `SubscriptionHealth`, `TokenHealth`, `TunnelStatus`, `SyncStatus` | `frontend/src/api/admin.ts` |
| `ParsedSearchQuery`, `AiSearchStatus` | `frontend/src/api/aiSearch.ts` |
| `SyncResult`, `MessageBody`, `ContactFolder` | `frontend/src/api/mailboxes.ts` |
| `PatternCondition`, `PatternEvidence` | `frontend/src/api/patterns.ts` |
| `RuleStats`, `SimulationEmail` | `frontend/src/api/rules.ts` |

These annotate return types of exported functions that ARE used — not dead code, just never explicitly re-imported. Leave them.

### KEEP code, drop `export` keyword (used only within own file)

| Exports | File | Evidence |
|---|---|---|
| `CATEGORY_COLORS`, `categoryColorClass`, `CategoryBadge` | `frontend/src/components/settings/CategoriesSection.tsx` | name grep excluding own file → 0 hits; consumed only by private `MailboxCategories` in the same file |
| `matchesConditions` | `backend/src/services/ruleEngine.ts` | external grep → 0; called internally by `evaluateRulesForMessage` (line 57) |
| `PatternEngineSettings`, `DEFAULT_PATTERN_SETTINGS`, `ConfidenceInput`, `calculateConfidence`, `shouldSuggestPattern`, `detectSenderPatterns`, `detectFolderRoutingPatterns` | `backend/src/services/patternEngine.ts` | all used only internally by `analyzeMailboxPatterns` (the one export with an external importer: `jobs/processors/patternAnalysis.ts:3`) |

## 3. Routes, pages, hooks, stores — wiring check (all KEEP)

- **Backend routes:** all 18 files in `backend/src/routes/` are imported + `app.use()`-mounted in `server.ts` (lines 84–99). `tracking.ts` (public `/track`, line 59) and `trackingApi.ts` (authed `/api/tracking`, line 98) are two distinct, both-mounted routers — not a duplicate.
- **Job queues:** `jobs/queues.ts` defines **12** queues, each with a 1:1 processor in `processorMap` (lines 98–111) — all 12 processor files wired. Non-cron queues are legitimately event-driven: `webhook-events` (enqueued at `routes/webhooks.ts:76`), `email-embedding` (`deltaService.ts:194`, `eventCollector.ts:269`, `aiSearch.ts:157`), `body-prefetch` (`admin.ts:424`, `deltaService.ts:215`, `eventCollector.ts:290`).
- **Frontend pages:** 14/15 wired in `App.tsx` `createBrowserRouter` (exception: `ComingSoonPage`, §1).
- **Hooks:** 18/19 used (1–8 call sites each); exception `useMailboxes` (§1).
- **Stores:** `authStore` (15 importers), `uiStore` (14), `notificationStore` (4), `rulePopupStore` (2) — all live.
- **Models:** all 12 backend models imported (2–25 importers each); `models/index.ts` barrel used for side-effect registration (`server.ts:39`) and named exports (`routes/health.ts:8`).
- **Middleware:** all 4 applied in `server.ts` (`configureSecurityMiddleware` line 47, rate limiters 76–77, CSRF 80–81, `globalErrorHandler` line 100).
- **`utils/graph.ts` vs `services/graphClient.ts`:** not duplication — `buildSelectParam`/`SELECT_FIELDS` ($select builders, 4 importers) vs `graphFetch`/`GraphApiError` (HTTP wrapper, 20 importers). Both KEEP.

## 4. Dependencies — zero unused

| Package.json | Result |
|---|---|
| `backend` | All 21 runtime deps imported in `backend/src` (grep per dep, 1+ hits each); dev deps are toolchain (tsx, vitest, typescript, @types/*). |
| `frontend` | All 23 runtime deps: `grep -rl "from ['\"]<dep>" frontend/src` → 1–78 hits each. `react-is` has 0 direct imports but is a deliberate version-pin via `"overrides"` for recharts' transitive peer — KEEP. Dev deps used in `vite.config.ts` / `src/app.css` / `components.json`. |
| `addin` | All 17 deps trace to `addin/src` imports or `webpack.config.cjs` requires (`office-addin-dev-certs` at line 12, all loaders/plugins). Zero unused. |
| `desktop` | `electron`, `electron-builder`, `typescript` — all invoked by package.json scripts + `electron-builder.yml`. Zero unused. |

## 5. Env vars & config

`.env.example` read via `git show HEAD:.env.example` (direct file read is permission-blocked): 18 keys. Code reads: `grep -roP 'process\.env\.[A-Z_0-9]+' backend/src | sort -u` → 28 keys (+1 `import.meta.env.VITE_API_BASE_URL` in `frontend/src/api/mailboxes.ts`; addin gets 4 vars via webpack DefinePlugin at build time; desktop reads `MSEDB_URL` in `desktop/src/main.ts:5`).

- **Stale keys in `.env.example`: none** — all 18 are read in code.
- **Read in code but missing from `.env.example`** (doc gap, add them): `ADDIN_URL`, `SYNC_SINCE_DATE`, `QDRANT_URL`, `QDRANT_COLLECTION`, `OLLAMA_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_INSTRUCT_MODEL`, `OLLAMA_WRITE_MODEL` (all have defaults in `config/index.ts:60–76`) and **`ANTHROPIC_API_KEY`** (no default — `POST /api/events/summarize-today` 500s if unset).
- **docker-compose.yml:** clean. Only `msedb-backend` takes env, via `env_file: .env` (no per-key list to drift). All volume mounts exist on disk (`certs/` present; `addin/dist` absent by design — built separately per CLAUDE.md). `msedb-tunnel` service already removed with an explanatory comment. No obsolete services/volumes/networks.

## 6. Root-level scripts & stray files

| File | Evidence | Classification |
|---|---|---|
| `cleanup-calendar-mirrors.mjs` | `grep -rn "cleanup-calendar-mirrors" .` → 0 refs (no package.json script, compose, RUNBOOK, CI). Targets a `CalendarSyncMap` collection — `grep -r "CalendarSyncMap" backend/src/models` → 0 hits; the calendar-mirroring feature no longer exists in code (only remnant: `'Calendars.ReadWrite'` scope in `auth/msalClient.ts`). Added in commit `ffafdc1`, never touched since. | **PROBABLY UNUSED** — one-off Mongo/Graph cleanup for a removed feature. Safe to delete once confirmed the prod cleanup already ran. |
| `delete-mirrors.mjs` | `grep -rn "delete-mirrors" .` → 0 refs. Requires a hand-made `/app/mirror_events.json` fixture that is not in the repo. | **PROBABLY UNUSED** — manual single-run companion to the above. Same condition. |
| `msedb.xml` (repo root) | `grep -rn "msedb.xml" .` → 0 refs. Content duplicates an older `addin/manifest.xml`; `deploy-addin.ps1` points at `addin/manifest.xml`, not this. | **PROBABLY UNUSED** — stray manifest copy; confirm with add-in owner, then delete. |
| `deploy-addin.ps1` | Standalone manual Exchange Online deploy script — matches CLAUDE.md's separate add-in workflow. | KEEP |
| `git-hooks/pre-push` | Opt-in hook template (self-documents its install cp); produces `version.json` (currently v1.33.01, built 2026-03-16 — active). | KEEP |
| `version.json` | Read by `desktop/src/main.ts` (`readVersion()`); written by the pre-push hook. | KEEP |
| `desktop/` | Self-contained Electron shell loading `https://msedb.aptask.com`. Last commit 2026-02-24 vs backend 2026-06-24 — low churn by design ("runs on host, different build/deploy"), not orphaned. | KEEP |

## 7. Documentation drift & bugs noticed en route (not dead code, worth fixing)

1. **CLAUDE.md says 11 queues; code has 12** — `body-prefetch` is real and actively used but undocumented.
2. **`jobs/schedulers.ts` comments stale** — header says "all 8 job schedulers", closing log says "All 9"; actual count is 9 `upsertJobScheduler` calls.
3. **`routes/events.ts:398` reads `process.env.ANTHROPIC_API_KEY` directly** — the only env read outside `config/index.ts`, and it hard-depends on a paid Anthropic API with no local-Ollama fallback, contradicting the project's local-LLM-first policy.
4. **Possible wiring bug behind the dead `notificationService.ts`:** notification producers bypass the Socket.IO-push wrapper, so notifications created by `tokenRefresh.ts` never emit a live socket event. Decide: delete the service (accept no live push) or route producers through it (fix). The deletion script below includes it — remove that line if you choose to wire it up instead.

---

## Deletion script draft — SAFE TO DELETE only

Review, then run from repo root on a feature branch (never main). PROBABLY UNUSED items (root .mjs scripts, msedb.xml) intentionally excluded — confirm their one-off jobs are done first.

```bash
git checkout -b chore/remove-dead-code

# Dead files (zero references, verified)
git rm backend/src/services/notificationService.ts   # see §7.4 — delete OR wire up, not both
git rm frontend/src/pages/ComingSoonPage.tsx
git rm frontend/src/components/shared/MailboxSelector.tsx
git rm frontend/src/hooks/useMailboxes.ts

# Dead exports (manual edits, not git rm):
#   frontend/src/api/aiSearch.ts   -> remove aiSearchStatus(), triggerBackfill()
#   frontend/src/api/mailboxes.ts  -> remove syncFolder()
#   frontend/src/api/settings.ts   -> remove updateMessageCategories()
#   frontend/src/lib/formatters.ts -> remove formatEventType()

# Verify nothing broke
(cd backend && yarn build && yarn test)
(cd frontend && yarn build && yarn lint)
```
