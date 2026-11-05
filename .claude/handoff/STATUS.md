<!-- resume-branch: main -->
# MSEDB session status (2026-11-05, TajHome-Room)

**Goal:** make rule-deleted mail actually reach Deleted Items. It was stuck in the MSEDB Staging folder, which is why
Taj saw unread ororo mail in Outlook that MSEDB's Inbox + Unread view does not list.

**Done (code):** fix/staging-never-completes was merged into develop.
- `dropStaleStagingTtlIndex()` removes a TTL index on `stagedemails.expiresAt` at startup (not in the schema).
- `isRuleExemptFolder()` stops rules acting on mail landing in Deleted Items or MSEDB Staging.

Shipped earlier today: `c750bf7` (filtered pills, Sender sort), `675f232` (unread sender volume filter).

**Verified before ship:** backend tsc, vitest 194/194, independent run, red-then-green rule test, folder ids on real data.

**In progress:** /tdone is shipping this to prod, then moves the approved taj@aptask.com backlog. If this note is the
newest thing you see, confirm prod's live commit first: the ship may have stopped.

**Owed after deploy:**
- Confirm the `expiresAt` TTL index is gone from `stagedemails`.
- Within about 24 hours, confirm rows reach `executed` and mail reaches Deleted Items without returning to staging.
- Signed-in UI check of the unread volume filter.

**Open questions:**
- Taj has not said whether to clean the backlog in taj@jobtalk.ai (247) and taj@yenom.ai (41).
- 14 `messaging-digest-noreply@linkedin.com` messages in taj@aptask.com staging have no delete rule; Taj decides.
- Rule-deleted counts include mail that never left staging, so the Deleted badge is overstated.
- Ollama down; Qdrant unreachable at startup; shirin@aptask.com sign-in expired.
- 12 stale `autorefactor/*` branches; 9 delete `backend/src/routes/events.ts`. Never merge them.

Next step: confirm prod serves the release, run the post-deploy checks above, then ask Taj about the open questions.
