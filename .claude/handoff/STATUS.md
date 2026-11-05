<!-- resume-branch: main -->
# MSEDB session status (2026-11-05, TajHome-Room)

**Goal:** two inbox bugs reported from msedb.aptask.com/inbox?date=all&status=unread.
1. Clicking the Sender header must sort ALL emails by sender email address.
2. The mailbox pills must show filtered numbers (Unified MB showed 77,417 while the list showed 1,884 unread).

**Done (code):** feature/thr-1105 was merged into develop.
- `backend/src/services/eventListFilter.ts`: one filter for the list and `/events/mailbox-counts`.
- `frontend/src/lib/inboxFilters.ts`: one source of filter params for InboxPage and Topbar.
- Sender header sorts on the server (`sortBy=sender.email`), blank addresses last, `_id` tiebreak.

**Verified before ship:** backend tsc, vitest 162/162, frontend build, CI on develop, sort pipeline on real data
(15,840 rows ordered both ways, read-only).

**In progress:** /tdone is shipping this to prod. If this note is the newest thing you see, confirm prod's live
commit first: the ship may have stopped.

**Live checks still owed after deploy:**
- Sender click reorders page 1 and page 2; a second click reverses; the sort survives a reload.
- With Unread + All + Inbox, the Unified MB pill equals the "N emails" count and the mailbox pills add up to it.

**Open questions:**
- Subject, Date, Folder, Status and Priority still sort only the loaded 50 rows. Taj has not asked to change them.
- `frontend/` has no ESLint installed, so `yarn lint` cannot run there.
- 12 `autorefactor/*` branches on origin are 82 commits behind main; 9 delete `backend/src/routes/events.ts`.
  Never merge them. Deleting or re-cutting them is Taj's call.

Next step: confirm prod serves the release, run the live checks above, then ask Taj what is next.
