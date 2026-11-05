<!-- resume-branch: main -->
# MSEDB session status (2026-11-05, TajHome-Room)

**Goal:** on the Unread filter, let Taj enter a number and see only unread emails from senders or domains with at
least that many unread, to spot who is piling up.

**Done (code):** feature/unread-sender-threshold was merged into develop.
- `backend/src/services/senderVolume.ts`: parse, list pipeline, pill pipeline, all in Mongo.
- `frontend/src/components/inbox/SenderVolumeFilter.tsx`: the control, shown only on Unread.
- `/events/mailbox-counts` now returns `total` for the unified pill.

Shipped earlier today in `c750bf7`: filtered mailbox pills and server-side Sender sort.

**Verified before ship:** backend tsc, vitest 182/182, frontend build, new pipelines on real mail against a separate
tally (totals, every pill, row counts, every page), and a stubbed render at 1600px and 375px.

**In progress:** /tdone is shipping this to prod. If this note is the newest thing you see, confirm prod's live
commit first: the ship may have stopped.

**Live checks still owed after deploy, signed in:**
- Unread + type 5: rows group biggest first, each with a count, and the Unified MB pill equals "N emails".
- Domain switch changes the groups; leaving Unread hides the box.
- From c750bf7: Sender sort survives a reload.

**Open questions:**
- 3 means "senders with 3 or more", not "exactly three messages". Taj has not confirmed this reading.
- Subject, Date, Folder, Status and Priority still sort only the loaded 50 rows.
- `frontend/` has no ESLint installed, so `yarn lint` cannot run there.
- Ollama router on the DGX returned 502 (nothing on 11435), so embeddings were failing.
- shirin@aptask.com refresh token expired; that mailbox must sign in again.
- 12 `autorefactor/*` branches on origin are stale; 9 delete `backend/src/routes/events.ts`. Never merge them.

Next step: confirm prod serves the release, run the signed-in checks above, then ask Taj what is next.
