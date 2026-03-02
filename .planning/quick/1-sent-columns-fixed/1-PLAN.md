---
phase: quick-1-sent-columns-fixed
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - frontend/src/components/inbox/InboxDataGrid.tsx
  - frontend/src/components/inbox/ComposeEmailDialog.tsx
  - backend/src/routes/mailbox.ts
  - frontend/src/api/mailboxes.ts
  - backend/src/jobs/processors/contactsSync.ts
autonomous: true
requirements: [SENT-COL-01, TRACK-OPT-01]

must_haves:
  truths:
    - "Switching to Sent folder preserves saved column layout (Opens column stays visible, order is maintained)"
    - "User can opt out of email open tracking when composing a new email"
    - "Backend only injects tracking pixel when track=true (or unset)"
  artifacts:
    - path: "frontend/src/components/inbox/InboxDataGrid.tsx"
      provides: "suppressSaveRef guard preventing column state overwrites during folder transitions"
      contains: "suppressSaveRef"
    - path: "frontend/src/components/inbox/ComposeEmailDialog.tsx"
      provides: "Track email opens checkbox in compose dialog"
      contains: "trackEmail"
    - path: "backend/src/routes/mailbox.ts"
      provides: "Conditional tracking pixel injection based on track flag"
      contains: "track !== false"
  key_links:
    - from: "frontend/src/components/inbox/ComposeEmailDialog.tsx"
      to: "frontend/src/api/mailboxes.ts"
      via: "sendNewEmail({ track })"
      pattern: "track.*trackEmail"
    - from: "frontend/src/api/mailboxes.ts"
      to: "backend/src/routes/mailbox.ts"
      via: "POST /mailboxes/:id/send-email body.track"
      pattern: "track"
---

<objective>
Commit two fixes already implemented in the working tree:

1. Sent-folder column state preservation — AG Grid fired `onStateUpdated` (columnOrder source) when columnDefs changed on folder switch, overwriting the saved Sent-folder preferences (including the Opens column) before the 50 ms restore timeout could run. A `suppressSaveRef` guard now blocks saves during that window.

2. Track-email opt-out in compose — Added a "Track email opens" checkbox (default on) to ComposeEmailDialog. The `track` boolean is forwarded through the API client to the backend, which only injects the tracking pixel when `track !== false`.

Purpose: Ship two targeted UX/correctness improvements — column state persistence and per-email tracking control.
Output: Clean commit with version bump.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify and commit sent-columns and track-opt-out changes</name>
  <files>
    frontend/src/components/inbox/InboxDataGrid.tsx
    frontend/src/components/inbox/ComposeEmailDialog.tsx
    backend/src/routes/mailbox.ts
    frontend/src/api/mailboxes.ts
    backend/src/jobs/processors/contactsSync.ts
    version.json
  </files>
  <action>
All changes are already implemented. Verify the key logic is present, then update version.json and commit.

Verification checks:
1. InboxDataGrid.tsx — confirm `suppressSaveRef` useRef is declared, `saveColumnState` guards on `suppressSaveRef.current`, and the folder-change useEffect sets `suppressSaveRef.current = true` before the 50 ms timeout.
2. ComposeEmailDialog.tsx — confirm `trackEmail` state exists (default `true`), Checkbox renders with Eye icon, and `track: trackEmail` is passed to the send call.
3. backend/src/routes/mailbox.ts — confirm `track` is destructured from req.body and `createTrackedEmail` / `injectTrackingPixel` are only called when `track !== false`.
4. frontend/src/api/mailboxes.ts — confirm `track?: boolean` is in the sendNewEmail params type.

Version update: increment subversion by .01 (v1.28.05 → v1.28.06) in version.json, update buildDate to current date/time.

Stage all modified files and commit:
```
git add frontend/src/components/inbox/InboxDataGrid.tsx
git add frontend/src/components/inbox/ComposeEmailDialog.tsx
git add backend/src/routes/mailbox.ts
git add frontend/src/api/mailboxes.ts
git add backend/src/jobs/processors/contactsSync.ts
git add version.json
```

Commit message:
```
fix: preserve sent-folder column state and add track-email opt-out

- Add suppressSaveRef guard in InboxDataGrid to prevent AG Grid's
  onStateUpdated from overwriting saved Sent-folder column preferences
  during folder transitions (Opens column and order now persist)
- Add "Track email opens" checkbox (default on) to ComposeEmailDialog
- Backend send-email route conditionally injects tracking pixel based
  on track flag; skips pixel when track=false
- Forward track param through API client (sendNewEmail)
```
  </action>
  <verify>
    <automated>git -C /home/admin/claude/MSEDB log --oneline -1</automated>
    <manual>After commit: switch to Sent folder in the inbox, confirm Opens column is present and column order matches what was saved. Compose a new email, confirm Track checkbox appears checked by default.</manual>
  </verify>
  <done>
    - git log shows the new commit at HEAD
    - version.json reads v1.28.06
    - suppressSaveRef pattern present in InboxDataGrid.tsx
    - trackEmail / track param wired through compose → API → backend
  </done>
</task>

</tasks>

<verification>
```
git -C /home/admin/claude/MSEDB log --oneline -3
git -C /home/admin/claude/MSEDB show --stat HEAD
```
Confirms all five files plus version.json in the commit.
</verification>

<success_criteria>
- Sent-folder column layout (including Opens column) persists across folder switches
- Compose dialog shows Track email opens checkbox, defaulting to checked
- Backend only injects tracking pixel when track is true
- Version bumped to v1.28.06
- Clean git history with single descriptive commit
</success_criteria>

<output>
No SUMMARY.md required for quick plans.
</output>
