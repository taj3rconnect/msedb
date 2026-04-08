## Product Strategy Review — MSEDB

### Score: 52 / 100

This is a technically ambitious project with a solid PRD, but the implementation has drifted significantly from the stated product vision. What started as "intelligent email cleanup via pattern detection and automated rules" has become a kitchen-sink email client that tries to do contacts management, calendar sync, email composition, AI search, daily summaries, and more -- all before the core workflow (observe -> detect patterns -> suggest rules -> automate) is polished enough to justify existence. The feature surface is wide but shallow.

### Critical Findings (must fix)

1. **Staging Page shows Message IDs instead of human-readable email info** — `StagingPage.tsx:102-103` — Users see meaningless Graph API IDs, can't identify emails before delete/rescue
2. **Duplicate "Actions" column headers** — `StagingPage.tsx:376-377`
3. **Hardcoded mailbox filter tags** — `RulesPage.tsx:40-44` — `taj@aptask.com`, `taj@jobtalk.ai`, `taj@yenom.ai` hardcoded
4. **InboxPage.tsx is 2,659-line God Component** — handles everything from email listing to compose to AI search
5. **Email body scope creep** — PRD says "Email body content is NEVER stored" but app evolved into full inbox client

### High Priority

6. No "Create Manual Rule" UI despite PRD requirement
7. Only 2 of 5 pattern types implemented (missing subject, time-based, composite)
8. No notification preferences in Settings
9. 90-day TTL on EmailEvents destroys pattern analysis capability
10. Reports only shows rule execution counts, not PRD success metrics

### Medium Priority

11. Calendar/Contacts scope creep without product rationale
12. Inconsistent mailbox selection (global store vs RulesPage local state)
13. No rule import/export
14. Missing "time saved" metric
15. Bare-bones pagination UX

### Low Priority

16. RulePopupModal outside router context
17. toggleIconSize causes full page reload
18. Hardcoded email recipient (taj@jobtalk.ai)
19. No retry buttons on error states

### Top 3 Recommendations

1. Fix Staging Page to show sender/subject/date instead of Message IDs
2. Rip out scope creep features and invest in core pattern-to-rule pipeline
3. Make Rules/Patterns dynamically multi-tenant

### Tough Questions

1. Why did you build a full email client when the PRD scopes Phase 1 to passive observation + pattern detection + automation?
2. Who besides you is actually using this product?
3. What is the actual pattern approval rate, and is the 98% default threshold too conservative?
