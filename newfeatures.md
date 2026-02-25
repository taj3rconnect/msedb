# MSEDB — Feature Suggestions

## High Impact — Daily Time Savers

### 1. Keyboard Shortcuts
Gmail-style keyboard shortcuts: `J/K` to navigate emails, `E` to archive, `#` to delete, `R` to reply, `G then I` to go to Inbox, `?` to show shortcut overlay. No shortcuts fire during text input.

### 2. "What If" Rule Simulator
Before activating a rule, click "Simulate" to see "This rule would have matched 47 emails in the last 30 days" with a preview list. Removes fear of creating a bad rule. Queries historical EmailEvent records — no Graph API calls.

### 3. Smart Unsubscribe
Detect newsletters/marketing emails and offer one-click unsubscribe. Show a "Newsletter" badge on inbox rows and a bulk "Unsubscribe & Delete All" action that hits the unsubscribe link + creates a delete rule. Already track `isNewsletter` in metadata.

### 4. Sender Reputation Dashboard
Dedicated view showing every sender ranked by volume, response rate, and average time-to-action. "Who's flooding my inbox?" at a glance. One-click "Block" or "Auto-delete" from the ranking. All data exists in EmailEvent collection.

### 5. Email Digest / Daily Summary
Morning email or in-app digest: "Yesterday you received 142 emails. 38 were auto-handled by rules. 12 new senders. 3 patterns need your attention." Optional Slack/Teams webhook for the summary.

---

## Medium Impact — Smarter Automation

### 6. "Snooze" Emails
Snooze an email to reappear at the top of inbox at a chosen time (tomorrow morning, next Monday, in 2 hours). Creates a staged action that moves it back from a hidden folder.

### 7. Smart Categories / Auto-Labels
Automatically categorize incoming email into buckets: Actionable, FYI, Newsletters, Receipts/Orders, Calendar, Social. Use subject/sender/body heuristics. Users can customize categories.

### 8. Sender Groups
Group senders (e.g., "Team", "Clients", "Vendors", "Newsletters") and apply rules or views per group. More intuitive than individual sender rules.

### 9. Rule Templates
Pre-built rule templates for common scenarios:
- "Auto-archive all CC'd emails"
- "Delete all marketing from domain X"
- "Move all emails with attachments to a folder"
- "Flag emails from VIP senders"

One-click setup instead of manual rule creation.

---

## UX Polish — Make It Feel Premium

### 10. Dark Mode
Add a dark theme toggle. The app already uses `next-themes` and Tailwind CSS variables — groundwork is there.

### 11. Onboarding Wizard
First-time users see a guided setup: connect mailbox → set working hours → review top 5 suggested patterns → approve/reject. Get them to value in 60 seconds.

### 12. Inline Stats on Rules (Sparkline Charts)
Each rule card already shows `totalExecutions` and `emailsProcessed` — add a mini sparkline chart showing activity over the last 30 days. Makes rules feel alive.

### 13. Toast Notifications for Real-Time Actions
When a rule fires via webhook, show a subtle toast: "Deleted email from noreply@linkedin.com (Rule: Social Noise)". Gives confidence automation is running.

---

## Power Features — Differentiation

### 14. Inbox Zero Tracker
Gamify it. Show a streak counter ("5 days at Inbox Zero"), weekly trends, and a progress bar toward daily zero.

### 15. Multi-Account Unified Inbox
Already supports multi-mailbox — add a "Unified" tab that merges all mailboxes into one view. Toggle between unified and per-mailbox.

### 16. Email Time Analytics
"You spend an average of 2.3 hours/day on email. You reply fastest to [sender]. Your busiest hour is 10-11 AM." Use existing event timestamps.

### 17. Cmd+K / Ctrl+K Command Palette
Search anything: senders, rules, settings, pages. Universal quick-access.

---

## Quick Wins (Low Effort, High Polish)

| Feature | Why |
|---|---|
| Favicon badge with unread count | Users see it on the browser tab |
| Bulk rule creation from sender breakdown | "Create delete rules for my top 10 spammers" |
| Export rules as shareable JSON | Share rule sets across accounts/orgs |
| Mobile-responsive layout | Check inbox from phone |
| Column persistence | Remember column order/visibility in localStorage |
