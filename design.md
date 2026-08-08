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

## Known UI gaps against the Per-App Standard

| Item | Status |
|---|---|
| `/sysinfo` page | **Missing** — no route, no component |
| Responsive toggle in the avatar menu (LAYOUT section) | **Missing** |
| Tables on vendored **prdgrid** | **Missing** — grids are built directly on AG Grid + TanStack Table; prdgrid is not vendored into the repo |
| Own logo | **Missing** — only a favicon exists |
| Own favicon | **Present** (`frontend/public/favicon.svg`) |

## References

- House rules (BINDING): `~/.claude/skills/tuiux/SKILL.md`
- Deep component audit: `/tuiaudit` · usability walkthrough: `/tuiaudit --usability`
- Design authoring: `/tuiaudit design`
