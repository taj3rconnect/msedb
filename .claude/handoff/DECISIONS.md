# Decisions and rules from this session

## From Taj (near-verbatim)
- "clicking on sender should sort all emails by sender email address and it is not happening."
- "When filtering for unread messages for all dates, for unified mailboxes, for all the mailboxes, it should show
  me the number of unread messages in the unified MB, where it is currently showing 77,417. The numbers are not
  right, so fix the numbers"

## Decisions made while working
- Branches in this repo start from `origin/main`, not `origin/develop`: GIT-001 in CLAUDE.md overrides the
  /tstart default. develop was 82 commits behind main until this session's merge.
- The pills follow date, status and folder, but not the search box.
- Sender sort means plain A-Z by address, with no-address rows last in both directions. Taj's message cut off
  after "it should look like this:", so no other layout was specified.
- The inbox grid stays on AG Grid; moving it to prdgrid was out of scope for this fix.
- /tprod runs with --no-merge here, so no other branch rides along into prod.

## Tried and failed
- Listing `.env` names in a shell command: refused by the secret gate. Not needed; skip that preflight row.
- Long `;`-chained Bash commands were denied; split them or use the dedicated tools.
