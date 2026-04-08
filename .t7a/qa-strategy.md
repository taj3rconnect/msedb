## QA Strategy Review — MSEDB

### Score: 8 / 100

2 test files covering 2 functions in 38,000+ lines of code. No CI/CD. No frontend tests. No integration tests. No E2E tests.

### Coverage Map

| Layer | Files | LOC | Test Files | Coverage | Risk |
|-------|-------|-----|------------|----------|------|
| Backend Routes | 19 | ~6,200 | 1 (partial) | <1% | CRITICAL |
| Backend Services | 22 | ~5,700 | 1 (partial) | ~2% | CRITICAL |
| Backend Auth | 5 | ~880 | 0 | 0% | CRITICAL |
| Backend Middleware | 3 | ~300 | 0 | 0% | HIGH |
| Backend Jobs | 13 | ~1,400 | 0 | 0% | CRITICAL |
| Backend Models | 14 | ~1,100 | 0 | 0% | MEDIUM |
| Frontend Pages | 16 | ~6,500 | 0 | 0% | HIGH |
| Frontend Hooks/API | ~15 | ~2,000 | 0 | 0% | HIGH |

### Critical Untested Paths

1. actionExecutor.ts — executes delete/move on real emails
2. ruleEngine.ts — matchesConditions() determines actions
3. graphRuleSync.ts — syncs to M365 rules, recursive retry risk
4. webhooks.ts — fire-and-forget processing
5. auth/middleware.ts — JWT verification
6. subscriptionService.ts — webhook subscriptions
7. deltaService.ts — delta sync state machine
8. stagingManager.ts + stagingProcessor.ts — the safety net
9. ruleConverter.ts — pattern-to-rule conversion
10. mailbox.ts (1,805 LOC) — largest route file

### Recommended Test Plan

**Phase 1 (Week 1):** matchesConditions(), executeActions(), graphClient, ruleConverter, toGraphRule
**Phase 2 (Week 2):** auth/middleware, errorHandler, webhooks route
**Phase 3 (Week 3-4):** Integration tests (pattern pipeline, staging flow, delta sync)
**Phase 4 (Week 5+):** Frontend tests, Playwright E2E, CI pipeline

### Top 3 Recommendations

1. Add matchesConditions() and executeActions() tests THIS WEEK
2. Add a CI pipeline before any more features ship
3. Stop building features — start testing the safety-critical path
