---
phase: quick-1-sent-columns-fixed
plan: 1
subsystem: frontend-grid, compose, backend-send
tags: [column-state, tracking, ag-grid, compose]
key-files:
  modified:
    - frontend/src/components/inbox/InboxDataGrid.tsx
    - frontend/src/components/inbox/ComposeEmailDialog.tsx
    - backend/src/routes/mailbox.ts
    - frontend/src/api/mailboxes.ts
    - backend/src/jobs/processors/contactsSync.ts
    - version.json
decisions:
  - suppressSaveRef useRef guard chosen over debounce to precisely block saves during folder transitions
  - trackEmail defaults to true to preserve existing behavior for users who do not opt out
metrics:
  duration: 5min
  completed: "2026-03-02"
  tasks_completed: 1
  files_modified: 6
---

# Quick Plan 1: Sent-Columns Fixed + Track Email Opt-Out Summary

**One-liner:** suppressSaveRef guard preserves Sent-folder AG Grid column layout; Eye checkbox adds per-email track opt-out wired from compose through API to backend pixel injection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify and commit sent-columns and track-opt-out changes | c9cf674 | InboxDataGrid.tsx, ComposeEmailDialog.tsx, mailbox.ts, mailboxes.ts, contactsSync.ts, version.json |

## What Was Built

### 1. Sent-Folder Column State Preservation (InboxDataGrid.tsx)

- Added `suppressSaveRef = useRef(false)` to track when a folder transition is in progress
- `saveColumnState` now returns early when `suppressSaveRef.current` is true
- The folder-change `useEffect` sets `suppressSaveRef.current = true` immediately before the 50ms restore timeout, preventing AG Grid's `onStateUpdated` (columnOrder source) from overwriting saved Sent-folder preferences (including the Opens column) during the transition window
- After `restoreColumnState` completes, `suppressSaveRef.current` is reset to false

### 2. Track Email Opens Opt-Out (ComposeEmailDialog.tsx + mailboxes.ts + mailbox.ts)

- `trackEmail` state added to `ComposeEmailDialog` (defaults to `true`)
- Checkbox with Eye icon renders in the compose footer, labeled "Track email opens"
- `track: trackEmail` is passed to `sendNewEmail()`
- `sendNewEmail` params type in `mailboxes.ts` includes `track?: boolean`
- Backend `send-email` route destructures `track` from `req.body` and only calls `createTrackedEmail` / `injectTrackingPixel` when `track !== false`

## Deviations from Plan

None - plan executed exactly as written. All logic was already implemented in the working tree; task was to verify and commit.

## Version

v1.28.05 -> v1.28.06

## Self-Check: PASSED

- frontend/src/components/inbox/InboxDataGrid.tsx: FOUND (suppressSaveRef present)
- frontend/src/components/inbox/ComposeEmailDialog.tsx: FOUND (trackEmail state, Eye checkbox)
- backend/src/routes/mailbox.ts: FOUND (track !== false conditional)
- frontend/src/api/mailboxes.ts: FOUND (track?: boolean in sendNewEmail params)
- version.json: FOUND (v1.28.06)
- Commit c9cf674: FOUND in git log
