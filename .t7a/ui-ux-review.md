## UI/UX Review — MSEDB

### Score: 58 / 100

### Critical Findings

1. **InboxPage.tsx 2,659 lines** with 55 useState/useEffect — unmaintainable monolith
2. **Zero route-level lazy loading** — all 14 pages eagerly imported in App.tsx:11-23
3. **ARIA coverage negligible** — only 20 aria-/role=/alt= across 14 files
4. **toggleIconSize forces full page reload** — uiStore.ts:62

### Design Consistency Issues

- Pagination copy-pasted 5 times across pages
- 3 different mailbox selection mechanisms (Topbar badges, MailboxSelector dropdown, hardcoded EMAIL_TAGS)
- Inconsistent page header structure
- Form labels without htmlFor (AuditLogPage:214,233,248,258)
- Loading state inconsistency (Skeleton vs Spinner vs LoadingSpinner)

### Accessibility Violations

| Severity | Issue | File | WCAG |
|----------|-------|------|------|
| A | Badges-as-buttons not keyboard focusable | Topbar.tsx:75-134 | 2.1.1 |
| A | No skip-to-content link | AppShell.tsx | 2.4.1 |
| A | KillSwitch no label association | KillSwitch.tsx:26 | 1.3.1 |
| A | Search clear buttons no aria-label | RulesPage.tsx:229 | 4.1.2 |
| A | Color-only status indicators | AppSidebar, KillSwitch, StagingPage | 1.4.1 |
| A | Duplicate Actions column headers | StagingPage.tsx:374-376 | 1.3.1 |

### Top 3 Recommendations

1. Break up InboxPage.tsx into composable sub-components
2. Add lazy loading and shared layout components
3. Run axe-core accessibility pass
