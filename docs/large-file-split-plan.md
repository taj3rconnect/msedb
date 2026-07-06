# Large-File Split Plan

Plan only — no code changes made. Covers the three files over 1,000 lines plus the two near-threshold files.

**Verification commands used throughout:**
- Backend: `cd backend && yarn build && npx vitest run`
- Frontend: `cd frontend && yarn build && yarn lint`

**Out of scope:** `frontend/src/components/ui/sidebar.tsx` (726 lines) is a vendored shadcn/ui component — leave it (and everything in `components/ui/`) alone.

**Test-coverage reality check:** `backend/src/routes/__tests__/` contains only `patterns-hasRule.test.ts`, which does not touch `mailbox.ts` or `rules.ts`. The backend splits have no route-level test safety net — `yarn build` catches type errors but not route-path/ordering regressions, so each backend step below includes a smoke-test note.

---

## 1. frontend/src/pages/InboxPage.tsx (2,714 lines)

### 1.1 Section map

| Lines | Contents |
|---|---|
| 1–75 | Imports, UI primitives |
| 76–108 | `InboxPage` wrapper — reads route param, connected-mailbox guard, renders `InboxEmailList` |
| 110–120 | `ConfirmPayload` interface (rule-creation payload) |
| 122–1891 | `InboxEmailList` — the monolith (all state, mutations, effects, JSX) |
| &nbsp;&nbsp;133–175 | Folder-sync state + `startFolderSync` + sidebar-click effect (eslint-disabled deps — intentional) |
| &nbsp;&nbsp;177–230 | Filter/selection/dialog/summary state (~15 `useState`s) |
| &nbsp;&nbsp;190–223 | Contacts search state + debounce effect |
| &nbsp;&nbsp;232–253 | `summarizeMutation`, `sendEmailMutation` |
| &nbsp;&nbsp;256–354 | Keyboard-nav state, panel layout persistence, preview state, auto-mark-read 3s effect, search debounce, URL sync, reset effects |
| &nbsp;&nbsp;357–400 | `dateRange` useMemo (date-filter → ISO range) |
| &nbsp;&nbsp;402–448 | Main `useQuery(['inbox-events', ...])`, `deletedEventIds` overlay, `visibleEvents`, sent-folder tracking-map effect |
| &nbsp;&nbsp;451–1062 | **10 mutations**: `confirmMutation` (create/update rules + run), `bulkDeleteMutation`, `bulkMarkReadMutation`, `quickDeleteMutation` (always-delete, all mailboxes), `justDeleteMutation`, `markReadMutation`, `quickMarkReadMutation`, `clearRulesMutation`, `undeleteMutation`, `syncMutation`, `emptyDeletedMutation` + `deleted-count` query |
| &nbsp;&nbsp;1073–1239 | `inboxShortcuts` useMemo (j/k/Enter/o/x/e/d/#/D/I/r/f///Escape) + `useKeyboardShortcuts` |
| &nbsp;&nbsp;1241–1891 | JSX: content-type tabs, contacts panel, date-filter toolbar, search bar, bulk-action bar, PanelGroup (InboxDataGrid + EmailPreviewPane), RuleActionsDialog, Summarize dialog (incl. inline PDF-print iframe logic 1819–1841), ComposeEmailDialog, AiSearchPanel |
| 1893–1927 | `highlightText()` helper, `SUMMARY_MESSAGES` |
| 1929–1970 | `SummarizeLoadingState` (self-contained) |
| 1974–2091 | `SYNC_MESSAGES`, `FolderSyncOverlay` (self-contained) |
| 2095–2175 | `HtmlEmailViewer` (sandboxed iframe, self-contained) |
| 2179–2714 | `EmailPreviewPane` — owns its own reply/replyAll/forward mutations and message-body/rules queries; talks to parent only via callbacks |

### 1.2 Target files (9 new files; main file drops from 2,714 to roughly 700–800 lines)

**Components → `frontend/src/components/inbox/`**

| New file | Moves | Notes |
|---|---|---|
| `EmailPreviewPane.tsx` | Lines 2179–2714 + `HtmlEmailViewer` (2095–2175) as private subcomponent | Cleanest cut: already fully prop-driven (`event`, `mailboxId`, `position`, `searchQuery`, `onClose`, `onJustDelete`, `onMarkRead`, `onQuickDelete`, `onQuickMarkRead`, `onAction`). ~620 lines out in one move. |
| `FolderSyncOverlay.tsx` | Lines 1974–2091 (`FolderSyncOverlay` + `SYNC_MESSAGES`) | Props: `progress`, `onCancel`. Zero risk. |
| `InboxSummaryDialog.tsx` | Lines 1736–1857 (Summarize dialog) + `SummarizeLoadingState` (1929–1970) + `SUMMARY_MESSAGES` | Props: `open`, `onOpenChange`, `summaryStats`, `summaryContent`, `isPending`, `onCancel`, email-form state/handlers, `mailboxId`. PDF-print block (1819–1841) moves to `lib/printSummary.ts`. |
| `InboxFilterToolbar.tsx` | Lines 1332–1462 (date tabs, Sync/Summarize/AI-Search buttons, unread toggle, preview-position toggle) | Pass compound handlers (`onReset`, `onSummarize`), not 8 raw setters — build `handleResetFilters` as a `useCallback` in the parent. |
| `InboxBulkActionBar.tsx` | Lines 1485–1521 | Props: `selectedCount`, `onDelete`, `onMarkRead`, `onCreateRules`, `onClear` + pending flags. |
| `InboxContactsPanel.tsx` | Lines 1266–1325 (contacts search UI) + move the contacts debounce state/effect (190–223) into it | Component owns its own query state; parent only passes `contactsMailboxId`/`contactsFolderId`. Removes ~90 lines total. |

**Lib → `frontend/src/lib/`**

| New file | Moves | Notes |
|---|---|---|
| `highlightText.ts` (or add to existing `formatters.ts`) | `highlightText` (1893–1902) | InboxDataGrid.tsx has its own copy (lines 92–100) — dedupe both to this one export. |
| `printSummary.ts` | PDF iframe + `window.print()` block (1819–1841) | Pure DOM function, no React. |
| `inboxCache.ts` | **New shared helper, not a move**: `markEventsReadInCache(queryClient, queryKeyId, predicate)` and `removeEventsFromCache(queryClient, queryKeyId, predicate)` | Replaces the 5 duplicated `queryClient.setQueriesData<typeof data>({queryKey: ['inbox-events', queryKeyId]}, ...)` blocks (lines 299, 644, 765, 849, 911). Highest-value extraction in the file — also solves the `typeof data` typing problem once (see risks). |

**Hooks → `frontend/src/hooks/`**

| New file | Moves | Inputs / returns |
|---|---|---|
| `useInboxMutations.ts` | All 10 mutations (451–1062) + wrapped handlers + `quickDeletePending` ref + `ConfirmPayload` interface | In: `mailboxId`, `isUnifiedMode`, `connectedMailboxes`, `visibleEvents`, `selectedIds`, `setSelectedIds`, `setDeletedEventIds`, `setPreviewEvent`, `dialogEvents`, `setDialogOpen`. Out: mutation objects (for `.isPending`) + `handleJustDelete`, `handleMarkRead`, `handleQuickDelete`, `handleQuickMarkRead`, `handleClearRules`, `handleUndelete`, `handleBulkAction`, `handleConfirm`, `handleGridAction`. Uses `lib/inboxCache.ts` for all optimistic updates. |
| `useFolderSync.ts` | Lines 133–175 (`syncState`, `startFolderSync`, sidebar-click effect) + `syncMutation` (1007–1022) | Reads `useUiStore` directly. **Preserve the `[folderSyncRequested]` dependency array and its eslint-disable verbatim** — widening it changes behavior. |

**Export changes:** `InboxPage` stays the sole export of `InboxPage.tsx`. New component files use named exports (matches existing `components/inbox/` convention). Confirm the events-list response type is exported from `@/api/events` (e.g. `FetchEventsResponse`); export it if not — required by `inboxCache.ts` and `useInboxMutations.ts` to replace `typeof data`.

**Deliberately NOT extracted (YAGNI):** `selectedIds`, `focusedIndex`, `previewEvent`, `dialogEvents`/`dialogOpen`, `page`/`search`/`dateFilter`/`unreadOnly` state and the `inboxShortcuts` useMemo stay in `InboxEmailList` as orchestration. They're each shared by 4+ consumers (grid, shortcuts, mutations, toolbar); hiding them inside a `useInboxFilters`/`useInboxSelection`/`useInboxKeyboardShortcuts` hook is prop-drilling by another name. The shortcuts block in particular closes over everything and contains ordering-critical logic — leave it where all its dependencies live. A dedicated `useInboxEvents` hook is likewise skipped; the raw `useQuery` is 17 lines.

### 1.3 Order of operations

Each step ends with: `cd frontend && yarn build && yarn lint` + open the Inbox page and click through the affected surface.

1. **Leaf lib helpers**: create `lib/highlightText.ts` (dedupe the InboxDataGrid copy too), `lib/printSummary.ts`. Update imports.
2. **Self-contained components**: move `EmailPreviewPane` + `HtmlEmailViewer`, `FolderSyncOverlay`, `InboxSummaryDialog` + `SummarizeLoadingState`. Pure moves, imports only. (~900 lines out.)
3. **`lib/inboxCache.ts`**: export the events response type from `@/api/events`, write the two cache helpers, replace all 5 inline `setQueriesData` blocks (including the auto-mark-read effect at line 299). *This is the one behavior-sensitive step — verify optimistic updates still work: quick-delete a sender and confirm rows vanish from all pages instantly.*
4. **`useInboxMutations.ts`**: move the 10 mutations wholesale (now trivial since cache surgery is in the lib helper). Keep every handler `useCallback`-wrapped so the shortcuts useMemo deps keep stable identities.
5. **`useFolderSync.ts`**: move sync state + effect + mutation, preserving the eslint-disable.
6. **Presentational bars**: `InboxFilterToolbar`, `InboxBulkActionBar`, `InboxContactsPanel`.
7. Final pass: `yarn build && yarn lint`, then manually verify keyboard shortcuts j/k/d/#/Escape, preview auto-mark-read (open an email, switch away before 3s — first email must NOT get marked read), and sent-folder tracking column.

### 1.4 Risks

- **`typeof data` closure (HIGH)**: 5 optimistic-update sites type their cache writes off the in-scope `data` variable. Any extraction breaks compilation until a real exported response type exists. Step 3 resolves this before the mutations move.
- **`d`-shortcut ordering (HIGH)**: lines 1131–1147 deliberately call `setPreviewEvent(nextEvent)` *before* `handleJustDelete(current)` so the mutation's `onMutate` sees the advanced preview (comment at line 1142). The shortcuts block stays in the main file precisely to avoid touching this; do not "clean it up" while migrating handlers.
- **Broad-prefix cache matches are intentional**: `quickDeleteMutation`/`quickMarkReadMutation` use `setQueriesData` on the `['inbox-events', queryKeyId]` prefix to hit *every* cached page. Do not narrow to the exact key in the lib helper.
- **Two eslint-disabled effects** (folder-sync 169–175, tracking-map 437–448) have intentionally narrow deps; the tracking effect deliberately reads `events`, not `visibleEvents`. Preserve verbatim.
- **Invalidation inconsistency (pre-existing, do not fix here)**: some mutations invalidate `['inbox-events']` broadly, `syncMutation` invalidates the scoped key. Leave as-is; note in a comment so reviewers don't think the split changed it.

---

## 2. backend/src/routes/mailbox.ts (2,163 lines)

### 2.1 Section map

| Lines | Contents |
|---|---|
| 1–26 | Imports, `Router()` |
| 28–71 | Helpers: `injectTrackingPixel` (28–38, compose-only), `HIDDEN_FOLDERS` (40–46, folders-only), `prependReplyHtml` (48–71, compose-only) |
| 74 | `mailboxRouter.use(requireAuth)` — applies to everything below |
| 76–152 | **Org whitelist** (admin): `GET/PUT /org-whitelist` — comment at line 77 says these must precede `/:id` routes |
| 154–339 | **Connection**: `POST /connect` (OAuth), `GET /` (list), `GET /autocomplete`, `DELETE /:id/disconnect` |
| 341–636 | **Folders**: `GET /:id/folders`, `getDbFolderCounts` helper (411–481, used by both folder listings), `GET /:id/folders/:folderId/children`, `POST /:id/folders/:folderId/sync` (SSE delta sync), `POST /:id/folders` (create) |
| 638–892 | **Actions**: `POST /:id/apply-actions`, `GET /deleted-count-all`, `GET /:id/deleted-count`, `POST /:id/empty-deleted` |
| 894–978 | **Messages**: `GET /:id/messages/:messageId` (body fetch, Redis cache, cid-image inlining) |
| 980–1326 | **Compose**: `POST /:id/reply`, `/:id/reply-all`, `/:id/forward`, `/:id/send-email` (all: draft → prependReplyHtml → tracking pixel → send) |
| 1328–1406 | **Per-mailbox whitelist**: `GET/PUT /:id/whitelist` |
| 1408–1820 | **Contacts**: `GET /:id/contact-folders`, `GET /:id/contacts` (Redis cache + background page-fill IIFE), `POST /:id/contacts/bulk-delete`, `POST /:id/contacts/import`, `DELETE/PATCH /:id/contacts/:contactId` |
| 1822–1991 | **AI**: `AI_WRITE_PROMPTS` const, `POST /:id/ai-write` (SSE Ollama stream), `POST /:id/messages/:messageId/auto-respond` (SSE, near-duplicate Ollama stream loop) |
| 1993–2161 | **Mailbox settings**: signatures `GET/PUT /:id/signatures`, OOF `GET/PUT /:id/oof`, categories `GET/POST/DELETE /:id/categories[...]`, `PATCH /:id/messages/:messageId/categories` |
| 2163 | `export default mailboxRouter` |

### 2.2 Target split — new directory `backend/src/routes/mailbox/` (first subrouter dir in the repo; 10 files)

| New file | Routes / helpers moved |
|---|---|
| `mailbox/index.ts` | Composes subrouters; `export default mailboxRouter`. Applies `requireAuth` **exactly once** here. |
| `mailbox/whitelist.ts` | `GET/PUT /org-whitelist` (with `requireAdmin`), `GET/PUT /:id/whitelist`. Declare `/org-whitelist` before `/:id/whitelist` (preserve source order). |
| `mailbox/connection.ts` | `POST /connect`, `GET /`, `GET /autocomplete`, `DELETE /:id/disconnect` |
| `mailbox/folders.ts` | All four folder routes + `HIDDEN_FOLDERS` + `getDbFolderCounts` (colocate — used only here) |
| `mailbox/actions.ts` | `apply-actions`, `deleted-count-all`, `deleted-count`, `empty-deleted` |
| `mailbox/messages.ts` | `GET /:id/messages/:messageId` + `PATCH /:id/messages/:messageId/categories` (message-scoped; moved from the categories tail). Replace the redundant dynamic `await import('../models/EmailEvent.js')` at line 2154 with the static import. |
| `mailbox/compose.ts` | reply / reply-all / forward / send-email + `injectTrackingPixel` + `prependReplyHtml` (colocate — used only here) |
| `mailbox/contacts.ts` | All six contact routes. **Preserve declaration order: `bulk-delete` and `import` BEFORE `/:id/contacts/:contactId`** — otherwise `:contactId` captures `"bulk-delete"`. |
| `mailbox/ai.ts` | `ai-write` + `auto-respond` + `AI_WRITE_PROMPTS`. Dedupe the two ~25-line Ollama SSE reader loops into one `streamOllamaTokens(res, prompt, opts)` — add it to the existing `services/ollamaClient.ts` (it already owns Ollama config/models). |
| `mailbox/settings.ts` | signatures, OOF, categories (minus the message-categories PATCH). Name collides conceptually with top-level `routes/settings.ts` — different module path, fine, but flag in PR description. |

**Index composition:**

```ts
import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
// ... subrouter imports (each exports its own Router instance, named export)

const mailboxRouter = Router();
mailboxRouter.use(requireAuth);          // once, here only
mailboxRouter.use(whitelistRouter);      // org-whitelist first (documented convention)
mailboxRouter.use(connectionRouter);     // owns bare '/' and root-level static paths
mailboxRouter.use(foldersRouter);
mailboxRouter.use(actionsRouter);
mailboxRouter.use(messagesRouter);
mailboxRouter.use(composeRouter);
mailboxRouter.use(contactsRouter);
mailboxRouter.use(aiRouter);
mailboxRouter.use(settingsRouter);
export default mailboxRouter;
```

**Import/mount changes:** `server.ts` line 19 changes from `'./routes/mailbox.js'` to `'./routes/mailbox/index.js'` (or stays literally `'./routes/mailbox.js'` if Node resolves the directory — with NodeNext/ESM `.js` specifiers it will NOT; use the explicit `/index.js` path). Mount line 86 unchanged. All relative imports inside moved files gain one `../` level (`'../models/...'` → `'../../models/...'`).

**Nothing moves to `services/`** except the optional `streamOllamaTokens` dedup into the existing `ollamaClient.ts`. `getDbFolderCounts`, `prependReplyHtml`, `injectTrackingPixel` are single-domain helpers — colocate with their subrouter (YAGNI).

### 2.3 Order of operations

Each step: `cd backend && yarn build && npx vitest run`, plus a smoke curl of the moved route group against a running dev container (no route tests exist — build alone won't catch path regressions).

1. Create `mailbox/index.ts` that, initially, just re-exports the existing monolith router (`export { default } from '../mailbox.js'` won't work long-term but proves the server.ts import-path change in isolation). Update `server.ts` import. Build + smoke `GET /api/mailboxes`.
2. Extract subrouters one per commit, in dependency-free order: `whitelist.ts` → `connection.ts` → `folders.ts` → `actions.ts` → `messages.ts` → `compose.ts` → `contacts.ts` → `settings.ts` → `ai.ts` (last, because it includes the ollamaClient dedup — the only non-mechanical change). After each: build, vitest, curl one route from the moved group.
3. When the last group moves, delete the old `routes/mailbox.ts` and the temporary re-export.
4. `ai.ts` step: add `streamOllamaTokens` to `services/ollamaClient.ts`, use it in both handlers. Verify SSE streaming manually (ai-write from the compose UI).
5. Fold the dynamic `EmailEvent` import cleanup into the `messages.ts` step.

### 2.4 Risks

- **Middleware ordering**: `requireAuth` must be applied once in `index.ts` before any subrouter mount. Dropping it (each file "looks authenticated") is the regression to guard; re-applying per-subrouter is merely wasteful.
- **Route-order traps**: (a) `/org-whitelist` before `/:id/whitelist` inside `whitelist.ts`; (b) `bulk-delete`/`import` before `:contactId` inside `contacts.ts` — the only two load-bearing orderings. No bare `/:id` route exists anywhere in this router (verified), so cross-subrouter mount order is currently safe — but document in `index.ts` that adding a bare `/:id` handler to any subrouter would shadow `/deleted-count-all`, `/autocomplete`, `/connect`, `/org-whitelist` depending on mount order.
- **SSE handlers** (`folders/:folderId/sync`, `ai-write`, `auto-respond`) write headers manually and must not pass through the global error handler after streaming starts — pure moves, but don't wrap them in new try/catch that re-throws.
- **No test net**: zero existing tests exercise this router. Smoke-curl each group after its move; compile success alone is insufficient.
- **Known duplication left for a follow-up PR** (do not mix into the split): the `Mailbox.findOne({_id, userId})` + `NotFoundError` ownership check repeats ~30×. A `router.param('id', ...)` middleware or `loadOwnedMailbox(req)` helper is the right dedup, but doing it during the move makes the diff non-mechanical. Split first, dedup second.

---

## 3. backend/src/routes/rules.ts (1,012 lines)

### 3.1 Section map

| Lines | Contents |
|---|---|
| 1–21 | Imports, `Router()`, `rulesRouter.use(requireAuth)` |
| 29–117 | `GET /` — list rules (pagination, search, aggregation sort for computed email/domain fields) |
| 125–246 | `POST /` — create rule (dedupe by sender+action, priority, AuditLog, Graph sync) |
| 254–265 | `POST /from-pattern` — thin wrapper over `convertPatternToRule` service |
| 273–290 | `POST /sync-to-graph` — thin wrapper over `syncAllRulesToGraph` service |
| 296–381 | `runSimulation()` — **~90 lines of inline business logic** (Mongo filter from rule conditions, 3 parallel queries), used by both simulate routes |
| 389–412 | `POST /simulate` — ad-hoc condition simulation |
| 423–459 | `PUT /reorder` — bulk priority update; **commented as required to precede `/:id`** |
| 466–518 | `PUT /:id` — update rule |
| 525–564 | `PATCH /:id/toggle` — enable/disable + Graph sync |
| 573–853 | `POST /:id/run` — **~280-line handler**: Graph pagination + client-side condition filter + inline action-application switch (delete/move/markRead/archive/forward) that **duplicates `services/actionExecutor.ts::executeActions`** |
| 861–882 | `POST /:id/simulate` — saved-rule simulation via `runSimulation` |
| 890–955 | `POST /delete-by-sender` — bulk delete rules across mailboxes |
| 962–1010 | `DELETE /:id` — delete rule (Graph first, then Mongo) |

### 3.2 Recommendation: NO subrouter directory — extract business logic to services instead

1,012 lines is over the threshold, but only 12 routes, all one resource. The bloat is two blocks of business logic living in the router, and both have service-shaped homes:

| Extraction | From | To | Effect |
|---|---|---|---|
| `runSimulation` | Lines 296–381 | `services/ruleEngine.ts` (it already owns condition-matching logic) as exported `simulateRule(userId, mailboxId, conditions, dateRange?)` | −90 lines; both simulate routes become thin |
| `POST /:id/run` internals | Lines 592–760 | Split: message-finding (Graph fetch + condition filter, 592–671) → new export `findMatchingMessagesForRule()` in `services/ruleEngine.ts`; action application (677–760) → **delete the inline switch and call the existing `services/actionExecutor.ts::executeActions` per message** | −170+ lines; router keeps orchestration + stats/audit |

Result: rules.ts drops to ~650–700 lines of pure route orchestration — in line with sibling flat files (patterns.ts is 507). A `routes/rules/` directory would be 4 files + index for a single-resource router: speculative, skip it. Revisit only if the file grows past ~1,000 again.

**Export/import changes:** `rulesRouter` named export and the `server.ts` mount are untouched. New named exports from `ruleEngine.ts`; no new files unless `ruleEngine.ts` itself would be pushed oversize, in which case use a new `services/ruleRunner.ts` for `findMatchingMessagesForRule`.

**Bug found during analysis (flag, decide separately):** the inline run-now switch bypasses the staging safety net that `executeActions` enforces (no `ensureStagingFolder`/`createStagedEmail` on delete) and writes one aggregate AuditLog instead of per-message entries. "Rule fires via webhook" and "user clicks Run Now" currently behave differently. Routing run-now through `executeActions` fixes this as a side effect of the refactor — but it IS a behavior change (deletes become staged). Get product sign-off on whether run-now should stage; if the answer is "keep direct deletes," pass `skipStaging: true` to `executeActions` and behavior is preserved exactly.

### 3.3 Order of operations

Each step: `cd backend && yarn build && npx vitest run`.

1. Extract `simulateRule` into `services/ruleEngine.ts`; both simulate routes call it. Pure move. Add one small vitest (`services/__tests__/ruleEngine-simulate.test.ts`) covering regex-escaping and sender-array matching — this branchy logic currently has zero tests.
2. Extract `findMatchingMessagesForRule` (Graph fetch + filter) into `ruleEngine.ts`.
3. Replace the inline action switch in `POST /:id/run` with `executeActions` calls (with `skipStaging: true` to preserve current behavior unless product says otherwise). Smoke-test: create a markRead rule in the UI, click Run Now, verify emails get marked and stats update.
4. Delete the now-dead inline helpers.

### 3.4 Risks

- **Route order**: `PUT /reorder` must stay declared before `PUT /:id` (already commented in-file). The only single-segment literal-vs-`/:id` collision in this router. Two-segment paths (`/:id/run`, `/:id/simulate`, `/:id/toggle`) are shape-disjoint and safe.
- **Behavior change vs. preservation** in step 3 — the `skipStaging` decision above. Default to preserving behavior; the staging inconsistency is a product call, not a refactor call.
- No cross-imports with mailbox.ts in either direction (verified) — the two backend splits are fully independent.
- No existing tests exercise rules.ts; step 1 adds the first one.

---

## 4. Near-threshold files

### 4.1 frontend/src/components/inbox/InboxDataGrid.tsx (935 lines) — SPLIT NOW (one extraction)

Section map: themes (45–90), `highlightText` copy (92–100), types (102–124), **10 AG Grid cell renderers (126–417, ~292 lines)** — incl. `RowActionsCellRenderer` (113 lines) and `OpensCellRenderer` (49 lines) — props/`columnDefs` memo (419–696), column-state persistence + grid lifecycle (699–828, genuinely interdependent via `suppressSaveRef`), JSX (830–935).

**Do:** move all 10 cell renderers + `highlightText` + `TrackingMatch`/`GridContext` types to `frontend/src/components/inbox/cells/InboxCellRenderers.tsx` (named exports, one file — they're small and cohere). The renderers read only `props.data`/`props.context`, zero closure over component internals — import-and-done, no prop changes. File drops to ~650 lines.

**Don't:** extract `columnDefs` (references props/conditionals of the main component) or the column-state persistence block (interlocked refs with a documented race-condition dance at 725–804). Optional nit: collapse the two near-duplicate theme objects into `buildGridTheme(isDark)` in-place.

Note: when Section 1 step 1 creates `lib/highlightText.ts`, this file's copy (92–100) is deleted then too — coordinate so it happens once.

Verify: `cd frontend && yarn build && yarn lint` + click every row-action button in the grid (both normal and deleted-folder views).

### 4.2 frontend/src/components/inbox/RuleActionsDialog.tsx (919 lines) — LEAVE ALONE

One cohesive form: ~19 `useState` fields all converge on `handleConfirm`/`handleSimulate`/`autoName`/`hasSelection`. The only clean seam (`FolderTreeItem`, 57–114) is already a separate component within the file, and the largest inline block (Move-folder picker, ~207 lines) would need 10+ state/setter props to extract — indirection, not readability. **Trigger to revisit:** if it crosses 1,000 lines or the move-picker grows another feature, extract `FolderTreeItem.tsx` first (free, zero prop cost), then a `MoveFolderPicker.tsx` that owns its own queries/mutations internally rather than lifting them.

### 4.3 frontend/src/components/ui/sidebar.tsx (726 lines) — LEAVE ALONE

Vendored shadcn/ui component. Never split vendored `components/ui/` files — it breaks upstream diff-ability.

---

## 5. Recommended Execution Order (across all files)

Each phase is independently shippable; backend and frontend tracks can run in parallel (no shared code).

| # | Task | Why this order | Verify |
|---|---|---|---|
| 1 | **rules.ts service extraction** (§3) | Smallest, self-contained, adds the first test for untested logic, and surfaces the staging-behavior product question early | `cd backend && yarn build && npx vitest run` + Run Now smoke test |
| 2 | **mailbox.ts subrouter split** (§2) | Biggest backend win; purely mechanical after the index.ts pattern is proven in step 2.1; one subrouter per commit keeps diffs reviewable | `cd backend && yarn build && npx vitest run` + curl per group |
| 3 | **InboxPage leaf extractions** (§1 steps 1–2: lib helpers + EmailPreviewPane/FolderSyncOverlay/InboxSummaryDialog) | ~900 lines removed at near-zero risk; also creates `lib/highlightText.ts` consumed by step 4 | `cd frontend && yarn build && yarn lint` + open inbox, preview, summarize |
| 4 | **InboxDataGrid cell-renderer extraction** (§4.1) | Depends on `lib/highlightText.ts` from step 3 | frontend build/lint + grid action-button click-through |
| 5 | **InboxPage cache helper + mutations hook** (§1 steps 3–4) | The behavior-sensitive frontend work — do it after the easy wins are merged and the response type is exported | frontend build/lint + optimistic-update and keyboard-shortcut manual checks (§1.3 step 7) |
| 6 | **InboxPage remaining hooks + bars** (§1 steps 5–6) | Cleanup; each independently small | frontend build/lint |
| — | RuleActionsDialog.tsx, sidebar.tsx | No action | — |

Follow-up backlog (separate PRs, not part of the split): mailbox ownership-check dedup (~30 sites, §2.4); run-now staging-behavior product decision (§3.2); inbox-events invalidation normalization (§1.4).
