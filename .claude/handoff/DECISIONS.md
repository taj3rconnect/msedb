# Decisions and rules from this session

## From Taj (near-verbatim)
- "clicking on sender should sort all emails by sender email address and it is not happening."
- "When filtering for unread messages for all dates, for unified mailboxes, for all the mailboxes, it should show
  me the number of unread messages in the unified MB, where it is currently showing 77,417. The numbers are not
  right, so fix the numbers"
- "Can you allow me to enter a number somewhere on the top? When I enter a number 5, show me only unread messages
  which has at least 5 emails from that same user. If I enter 3, show me three messages from the same user which
  are unread. This should be available only in the unread filter. The goal is to identify an email address which
  is sending me a lot of emails and it's accumulating too many emails from the one sender or one domains."
- Taj's examples: rows from `dan@tldrnewsletter.com` (many display names) and `hello@grow.briefs.co`.

- "email from ororo are not showing in filter" (Outlook showed 11 unread from ororo; MSEDB showed 0).
- Taj chose, for the mail stuck in MSEDB Staging on taj@aptask.com: "Delete if rule matches": move to Deleted Items
  only mail whose sender has an active delete rule, and list the rest for review.
- Taj approved removing the stale index, knowing rule-deleted mail will really move to Deleted Items after 24 hours.

## Decisions made while working
- Branches in this repo start from `origin/main`, not `origin/develop`: GIT-001 in CLAUDE.md overrides the
  /tstart default.
- The pills follow date, status, folder and the unread volume filter, but not the search box.
- Sender sort means plain A-Z by address, with no-address rows last in both directions.
- The volume filter is a threshold, counts by address (not display name) with a Domain switch, and sorts biggest
  first. A mailbox pill counts within that mailbox; the unified pill counts across mailboxes.
- The inbox grid stays on AG Grid; moving it to prdgrid was out of scope.
- /tprod runs with --no-merge here, so no other branch rides along into prod.

## Tried and failed
- Listing `.env` names in a shell command: refused by the secret gate. Not needed; skip that preflight row.
- Long `;`-chained Bash commands were denied; split them or use the dedicated tools.
- The Chrome extension was not connected all session; Playwright cannot sign in, so UI checks used stubbed data.
