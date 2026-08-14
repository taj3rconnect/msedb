# UI audit — MSEDB — 2026-08-13

Mode: standard `/taudit ui` (house-rules compliance). NOT `--usability`. State 3
(coded screens) — audited `frontend/src/` only, static pass, no dev server / browser
per HARD RULES. Static-only evidence caps every check at PASS/FAIL-on-source or
PARTIAL — no live spot-check was run, so nothing here is claimed as runtime-proven.

Baseline: a full standards pass ran 2026-08-08 (`docs/tauditall-2026-08-08.md`) and
found several of the same gaps. This run re-verifies each rule against today's
`main` and reports current file:line evidence — items unchanged since 2026-08-08
are noted as such.

## Findings

### UI-01 · MEDIUM · ui · impact M / effort L · status: OPEN
**Where:** `frontend/src/pages/ReportsPage.tsx:87-91,175-179` and `frontend/src/components/contacts/DuplicatesPanel.tsx:469,488,538`
**Claim:** Numeric table columns (report counts, contact "Fields" score) use `text-center` on both `TableHead` and `TableCell`, not right-aligned, violating the binding house rule "All numbers, amounts, percents — data AND headers — are right aligned. Always."
**Why it matters:** Inconsistent numeric alignment makes columns harder to scan and reads as a template default rather than an intentional data table; it is the exact anti-pattern the `ui` dim's eval contract targets.
**Fix:** In `ReportsPage.tsx` change the 5 numeric `TableHead`/`TableCell` pairs (Deleted, Moved & Read, Moved Only, Mark Read, Total) from `text-center` to `text-right`; in `DuplicatesPanel.tsx` change the "Fields" `TableHead`/`TableCell` pair the same way.
**Verifier:** `grep -c 'text-center' frontend/src/pages/ReportsPage.tsx frontend/src/components/contacts/DuplicatesPanel.tsx` — currently reports 11 combined hits on numeric-column cells/headers; fixed state has 0 `text-center` occurrences on those numeric cells (a manual check that only the numeric-column classes changed, not unrelated `text-center` usage, is needed since the grep is coarse).
**Eligible for --fix:** yes

### UI-02 · HIGH · ui · impact M / effort H · status: OPEN
**Where:** `frontend/src/components/shared/LoadingSpinner.tsx:1-21`; 25 files under `frontend/src` render inline `animate-spin` directly (only 4 consumers use `LoadingSpinner`, e.g. `pages/SettingsPage.tsx`, `components/settings/CategoriesSection.tsx`, `components/settings/OutOfOfficeSection.tsx`)
**Claim:** The house rule "every screen that fetches from the DB shows the ONE shared progress popup — real-time status messages, emojis, and a Cancel/action control" is not met: `LoadingSpinner` is a bare centered `Loader2` icon with no status text, no emoji, and no Cancel control, and the large majority of loading states (25 of 29 files touching `animate-spin`) bypass it entirely with per-component inline spinners.
**Why it matters:** Every screen reinvents its own loading UI, so users get inconsistent feedback and no way to cancel a long-running fetch — this is unchanged from the 2026-08-08 audit (`tauditall` GAP #6).
**Fix:** Design and build one shared `<FetchProgressPopup>` component (status message + emoji + Cancel) per the house rule, then migrate the 25 inline-spinner call sites onto it — largest offenders first (`BulkRuleDrawer.tsx`, `InboxDataGrid.tsx`, `DuplicatesPanel.tsx`).
**Verifier:** `grep -rl "animate-spin" frontend/src --include=*.tsx | grep -v -e LoadingSpinner.tsx | wc -l` — currently 24 (all but the component file itself); target is a controlled, low number once the shared popup is the only source of `animate-spin` for data-fetch loading states (button/pending-mutation spinners are a separate, acceptable use — the verifier needs human judgment to distinguish the two, so treat the count trend, not a hard zero, as the pass bar).
**Eligible for --fix:** no — component authoring / design decision, not a mechanical rule violation (per `dims/ui.md` fix-eligibility list)

### UI-03 · HIGH · ui · impact M / effort L · status: OPEN
**Where:** `frontend/src/components/settings/SignaturesSection.tsx:103-110` (`remove(sig.id)` at line 51-59)
**Claim:** Clicking the trash-icon button next to a signature calls `remove()` immediately with no confirmation dialog, unlike every other destructive control in the app (`RuleCard.tsx:311-343` delete, `PatternCard.tsx:421-445` unapprove, `BulkRuleDrawer.tsx:462-520` suppress) which all wrap the destructive action in an `AlertDialog`.
**Why it matters:** A user can lose a configured signature with a single misclick and no "are you sure" — inconsistent with the destructive-action pattern used everywhere else in this codebase and with CLAUDE.md's "never lose stored data" posture (the delete is staged client-side until Save, but nothing tells the user that, and the row simply vanishes).
**Fix:** Wrap the delete button in an `AlertDialog` matching the pattern already used in `RuleCard.tsx:311-343`, confirming "Delete signature '{name}'?" before calling `remove(sig.id)`.
**Verifier:** `grep -n "onClick={() => remove(sig.id)}" -B5 frontend/src/components/settings/SignaturesSection.tsx | grep -q AlertDialogTrigger` — fails now (no match), passes once the button is wrapped in an `AlertDialogTrigger`.
**Eligible for --fix:** yes

### UI-04 · MEDIUM · ui · impact L / effort L · status: OPEN
**Where:** `frontend/src/components/settings/SignaturesSection.tsx:103-110` (delete button), `:90-102` (default/star button has a `title` but no `aria-label`)
**Claim:** The icon-only delete button (`<Trash2>`) has neither `aria-label` nor `title` nor visible text — a screen reader announces it as an unlabeled "button" with no accessible name.
**Why it matters:** Accessibility is on the CLAUDE.md never-simplify-away list; an icon-only control with zero accessible name is unusable via assistive tech, and it is the one icon button in this file missing even the weaker `title` fallback that its sibling (Star/StarOff) has.
**Fix:** Add `aria-label="Delete signature"` (or `` `Delete signature "${sig.name}"` ``) to the button at line 103.
**Verifier:** `grep -n 'text-destructive hover:text-destructive"$' -A3 frontend/src/components/settings/SignaturesSection.tsx | grep -q 'aria-label'` — fails now, passes once the label is added.
**Eligible for --fix:** yes

### UI-05 · MEDIUM · ui · impact M / effort H · status: OPEN
**Where:** `frontend/src/components/ui/select.tsx` (Radix static select) used in 15 files, ~103 `<Select` occurrences (`components/admin/OrgRulesSection.tsx`, `components/events/EventFilters.tsx`, `pages/RulesPage.tsx`, `components/patterns/PatternFilters.tsx`, etc.); `cmdk` is not a dependency
**Claim:** The house rule "ALL dropdowns are typeahead searchable" is violated app-wide — every `<Select>` is a static (non-filterable) shadcn/Radix select, and there is no combobox/command primitive anywhere in the tree to build one from.
**Why it matters:** Unchanged from the 2026-08-08 audit (GAP #9); long option lists (mailbox pickers, category/folder selects) force scrolling instead of type-to-filter.
**Fix:** Add `cmdk` (vet per global standards — active maintenance, real download count), build a shadcn `Combobox`/`Command` wrapper, and migrate selects one at a time starting with the highest-cardinality ones (mailbox, folder, category pickers).
**Verifier:** `grep -rc "cmdk" frontend/package.json` — currently 0 (dependency absent), passes once `cmdk` is installed AND at least the highest-traffic selects are migrated (dependency presence alone is necessary but not sufficient — human check needed for actual migration coverage).
**Eligible for --fix:** no — component authoring across many call sites, not a single mechanical change

### UI-06 · LOW · ui · impact L / effort M · status: OPEN
**Where:** `frontend/src/App.tsx` (no `/sysinfo` route or component anywhere in `frontend/src/pages/`)
**Claim:** The Per-App Standard's SYSINFO page is missing — no route, no component.
**Why it matters:** Unchanged from 2026-08-08 (GAP #11); SYSINFO is the standard place to expose build/version/health info to an operator without shelling into the DGX.
**Fix:** Add a `/sysinfo` route + `SysInfoPage.tsx` per `~/.claude/skills/taudit/references/app/standard-spec.md` §In-app features, surfacing version (already read server-side in `backend/src/routes/health.ts:11-23`), build date, and live health-check status.
**Verifier:** `grep -c "sysinfo" frontend/src/App.tsx` — currently 0, passes once a `/sysinfo` route is registered.
**Eligible for --fix:** no — new page/feature build, not a mechanical fix

### UI-07 · LOW · ui · impact L / effort L · status: OPEN
**Where:** `frontend/src/components/layout/Topbar.tsx:188-213` (avatar `DropdownMenu` — only shows name/email + Log out)
**Claim:** The Per-App Standard's avatar-menu → LAYOUT → Responsive toggle is absent from the only user menu in the app.
**Why it matters:** Unchanged since 2026-08-08; no in-app way to switch the declared Responsive layout mode.
**Fix:** Add a "Layout" submenu/item to the `DropdownMenuContent` in `Topbar.tsx:196-212` with the Responsive toggle per the standard spec.
**Verifier:** `grep -c -i "responsive" frontend/src/components/layout/Topbar.tsx` — currently 0, passes once a Responsive control exists in this menu.
**Eligible for --fix:** no — new feature, needs a design decision on where layout state lives

### UI-08 · LOW · ui · impact L / effort L · status: OPEN
**Where:** `backend/src/routes/health.ts:36` (`router.get('/api/health', ...)`)
**Claim:** The standard health-check path is `/api/v1/health` (ezvms reference pattern); this app serves only `/api/health`, with no `/api/v1/health` alias.
**Why it matters:** Low risk (health checks work today), but breaks the convention other Per-App-Standard tooling expects at that exact path.
**Fix:** Add `router.get('/api/v1/health', ...)` as an additional route bound to the same handler in `health.ts:36` (additive, non-breaking — the existing `/api/health` path can stay for backward compatibility).
**Verifier:** `grep -c "'/api/v1/health'" backend/src/routes/health.ts` — currently 0, passes once the alias route exists.
**Eligible for --fix:** yes

## Not doing (and why)

- **prdgrid vendoring / AG Grid + TanStack Table migration** (`InboxDataGrid.tsx`, `InboxCellRenderers.tsx`, `EmailActivityPage.tsx`, `EventsTable.tsx`, and the hand-rolled `<table>` in `BulkRuleDrawer.tsx`) — confirmed still unvendored, unchanged from 2026-08-08 GAP #8. Not re-listed as a fresh numbered finding here (it is the same open item, still tracked); a full-repo grid migration is out of scope for a mechanical `--fix` and belongs in a dedicated follow-up pass.
- **Core UX contract check (never create a rule without approval)** — verified PASS by reading `frontend/src/components/patterns/PatternCard.tsx:275-318` (Approve/Reject require an explicit click, `canAct` gates the buttons) and `BulkRuleDrawer.tsx:223-257` (`handleCreate` only fires on the Apply button, nothing auto-runs on drawer open — the drawer's own fetch is gated on `open`, confirming the "never auto-fetch on view load" rule too for this surface). No violation found; not written up as a finding.
- **Dialogs / OS alerts** — zero `alert(`/`confirm(`/`prompt(` in `frontend/src` (grepped, none). PASS, matches 2026-08-08.
- **`$` sign / currency formatting** — zero matches in `frontend/src` for `$`-prefixed value formatting. PASS.
- **Form label association** — spot-checked `RuleEditDialog.tsx` (12+ `Label htmlFor=` pairs correctly wired to their inputs). PASS on this sample; not exhaustively checked across every form.
- **Live spot-check (Step 2 of the standards doctrine)** — not run per this task's HARD RULES (no dev server, no browser). Every finding above is source-only evidence; nothing here is proven live.

## Checks

```csv
check_id,dim,status,score,max,note
UI-01,ui,FAIL,0,2,numeric columns center-aligned in ReportsPage.tsx and DuplicatesPanel.tsx
UI-02,ui,FAIL,0,3,no shared progress-popup component; 24/25 loading states bypass LoadingSpinner
UI-03,ui,FAIL,0,3,signature delete has no confirmation dialog
UI-04,ui,FAIL,0,2,signature delete icon button has no accessible name
UI-05,ui,FAIL,0,2,all dropdowns are static Select, no typeahead/cmdk anywhere
UI-06,ui,FAIL,0,1,no /sysinfo route
UI-07,ui,FAIL,0,1,no Responsive toggle in avatar menu
UI-08,ui,FAIL,0,1,health endpoint at /api/health not /api/v1/health
UI-09,ui,PASS,5,5,core UX contract — no rule created without explicit approve click (PatternCard.tsx, BulkRuleDrawer.tsx)
UI-10,ui,PASS,2,2,no OS alert()/confirm()/prompt() anywhere in frontend/src
UI-11,ui,PASS,2,2,no `$` sign in value formatters/displayed amounts
UI-12,ui,PASS,1,1,own logo + favicon present (components/brand/Logo.tsx, frontend/public/favicon.svg)
UI-13,ui,PASS,2,2,RuleEditDialog form inputs correctly labeled via htmlFor (spot-check)
UI-14,ui,PASS,3,3,ReportsPage.tsx has full loading/error/empty state coverage via Skeleton + EmptyState
UI-15,ui,PASS,3,3,BulkRuleDrawer.tsx has full loading/error/empty state coverage + destructive-action confirm
UI-16,ui,NOT_EVALUATED,,3,live spot-check not run — no browser/dev-server per task HARD RULES
UI-17,ui,NOT_EVALUATED,,2,color-contrast not evaluated statically — needs rendered/visual check
```
