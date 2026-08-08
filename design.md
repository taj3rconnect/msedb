# design.md — MSEDB UI direction

Seeded by `/tappaudit --fix` on 2026-08-08 from what the code actually uses. The
creative direction below is **not yet authored** — run `/tuiaudit design` to fill
it in, and read `~/.claude/skills/tuiux/SKILL.md` before editing any UI file.

## What exists today (detected, not decided)

| Layer | Choice |
|---|---|
| Component library | **shadcn/ui** on **Radix UI** (`radix-ui` 1.4.3, `shadcn` 3.8.5 generator) |
| Styling | **Tailwind CSS 4** via `@tailwindcss/vite`, plus `tw-animate-css` |
| Variants | `class-variance-authority` + `clsx` + `tailwind-merge` |
| Icons | **lucide-react** |
| Theming | `next-themes` — light/dark supported |
| Charts | **Recharts** |
| Data grids | **AG Grid** (`InboxDataGrid`, cell renderers) and **TanStack Table** (`EventsTable`) |
| Notifications | **Sonner** toasts |
| Layout | `react-resizable-panels`, `@dnd-kit` for drag & drop |
| Brand marks | `frontend/public/favicon.svg` (own asset, MSEDB mark). **No separate logo asset** — see gaps. |

## Direction — TODO

- **Personality / tone:** TODO (`/tuiaudit design`)
- **Type scale & families:** TODO
- **Color tokens** (light + dark): TODO — currently whatever shadcn's default
  theme emits
- **Spacing / density:** TODO — this is a dense operational dashboard; density
  is a real decision, not a default
- **Motion:** TODO
- **Empty / loading / error states:** TODO

## Standards audit — `/tuiaudit` 2026-08-08

Audited against the BINDING house rules in `~/.claude/skills/tuiux/SKILL.md`
(§House rules) and `standard-spec.md` §In-app features.

**Static pass only.** MSEDB has no staging or local environment — the only
running instance is production, and `/tuiaudit` never runs a live pass against
prod without an explicit OK. Every rule below is therefore capped at **PARTIAL**
where runtime behavior is what actually decides it. Re-run `/tuiaudit` once a
non-prod environment exists.

| # | Rule | Status | Evidence |
|--:|---|---|---|
| 1 | App shell always visible (never a blank screen) | PARTIAL (pass on static) | All 12 authenticated routes nest under the layout route in `frontend/src/App.tsx:88-137`; only `/login` and `*` sit outside |
| 2 | Empty tables show "zero rows", never an error | PARTIAL (pass on static) | Shared `components/shared/EmptyState.tsx` used in ActivityFeed, PendingSuggestionsSection, EventsTable:208, NotificationDropdown, MailboxSection |
| 3 | Numbers/amounts/percents + headers right-aligned | **GAP** | No `type: 'numericColumn'`, no numeric `cellClass`/`headerClass` anywhere. All 9 `text-right` occurrences are on **text** labels (`ContactDetailDialog.tsx`, `AiSearchPanel.tsx:225`, `ContactsPage.tsx:526`) |
| 4 | No `$` on displayed amounts | **N/A** | MSEDB displays no monetary values — zero currency formatters or `USD` references |
| 5 | Never auto-fetch on view load | PARTIAL | React Query hooks fetch on mount; only 1 `enabled:` guard across `hooks/`. Judgment: this rule targets heavy scan/screener queries, and a live mailbox dashboard arguably wants fetch-on-open — needs a human call, not an automated rewrite |
| 6 | ONE shared progress popup for DB fetches | **GAP** | `components/shared/LoadingSpinner.tsx` exists but **38 files** render inline `animate-spin`/`<Skeleton>`/`Loader2` directly. No shared popup with real-time status + Cancel exists |
| 7 | In-app error dialogs with a copy button, never OS alerts | PARTIAL (pass on static) | **Zero** `alert(` / `confirm(` / `prompt(` in `frontend/src`. Copy-button coverage on error dialogs not statically verifiable |
| 8 | Tables/grids build on vendored **prdgrid** | **GAP** | prdgrid is not vendored anywhere in the repo. Grids build directly on AG Grid 35 (`InboxDataGrid.tsx`, `InboxCellRenderers.tsx`, `EmailActivityPage.tsx`) and TanStack Table (`EventsTable.tsx`) |
| 9 | ALL dropdowns typeahead searchable | **GAP** | **103 `<Select` usages across 14 files**, all Radix/shadcn static selects. No `command.tsx`, no combobox component, and `cmdk` is not even a dependency — the app has no typeahead primitive at all. (Good news: zero native `<select>`) |
| 10 | Own logo + favicon | **PASS** | `components/brand/Logo.tsx` (custom MSEDB envelope mark) + `frontend/public/favicon.svg` (own asset, not a framework default) |
| 11 | SYSINFO page at `/sysinfo` | **GAP** | No route in `App.tsx`, no component anywhere |
| 12 | Responsive toggle in avatar menu (LAYOUT section) | **GAP** | `components/layout/Topbar.tsx:197-211` — the avatar dropdown contains only a label and Logout. No LAYOUT section, no Responsive toggle, no System Info link |
| 13 | `/api/v1/health` endpoint | PARTIAL | `backend/src/routes/health.ts` is well built — versioned payload, DB + Redis gates, correct 200/503, no secrets, minimal body when unauthenticated — but it is mounted at **`/api/health`**, not the standard `/api/v1/health` |
| 14 | Accessibility basics | NOT EVALUATED | Requires the live pass (focus order, focus trap, contrast, reduced motion). Radix primitives supply the baseline, which is a good starting point but not proof |

**Score: 1 PASS / 12 applicable rules** (1 N/A, 1 NOT EVALUATED) — 5 GAP, 6 PARTIAL.

Nothing in this table was auto-fixed: every GAP is UI authoring (component
rebuilds, new pages), which the audits flag and never scaffold. See
`docs/tauditall-2026-08-08.md` for the ordered queue and the exact command per item.

## References

- House rules (BINDING): `~/.claude/skills/tuiux/SKILL.md`
- Deep component audit: `/tuiaudit` · usability walkthrough: `/tuiaudit --usability`
- Design authoring: `/tuiaudit design`
