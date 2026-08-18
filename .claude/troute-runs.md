# Dispatch log

Written automatically by `~/.claude/hooks/dispatch-log.py` (SubagentStop).
`tos` Step 0.2 and `troute` Step 4 read this to calibrate model tier.
`escalate` = the agent died, timed out, or errored.
`unknown` = the hook could not read the reply — NOT an agent failure;
do not calibrate a tier up from it.

| when | agent | model | outcome | detail | task |
|------|-------|-------|---------|--------|------|
| 2026-08-18 12:32 | agent | claude-opus-5 | ok | 188 chars |  |
| 2026-08-18 12:33 | agent | claude-opus-5 | ok | 110 chars |  |
| 2026-08-18 12:33 | agent | claude-opus-5 | ok | 110 chars |  |
| 2026-08-18 12:35 | agent | claude-opus-5 | ok | 181 chars |  |
| 2026-08-18 12:36 | agent | claude-opus-5 | ok | 181 chars |  |
| 2026-08-18 12:36 | agent | claude-opus-5 | ok | 181 chars |  |
| 2026-08-18 12:49 | agent | claude-sonnet-5 | ok | 393 chars |  |
| 2026-08-18 12:50 | agent | claude-sonnet-5 | ok | 317 chars |  |
| 2026-08-18 12:50 | agent | claude-sonnet-5 | ok | 317 chars |  |
| 2026-08-18 12:53 | agent | claude-sonnet-5 | ok | 141 chars |  |
| 2026-08-18 13:03 | agent | claude-sonnet-5 | ok | 53 chars |  |
| 2026-08-18 13:04 | agent | claude-sonnet-5 | ok | 53 chars |  |
| 2026-08-18 13:04 | agent | claude-sonnet-5 | ok | 53 chars |  |
| 2026-08-18 13:05 | agent | claude-sonnet-5 | ok | 121 chars |  |
| 2026-08-18 13:06 | fable5 | claude-sonnet-5 | ok | 121 chars |  |
| 2026-08-18 13:09 | agent | claude-sonnet-5 | thin | 22 chars |  |
| 2026-08-18 13:13 | agent | claude-sonnet-5 | ok | 205 chars |  |
| 2026-08-18 13:14 | agent | claude-sonnet-5 | ok | 205 chars |  |
| 2026-08-18 13:14 | codex | claude-sonnet-5 | ok | 205 chars |  |
| 2026-08-18 13:20 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:21 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:22 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:22 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:24 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:25 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:25 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:26 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:26 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:27 | agent | claude-sonnet-5 | thin | 38 chars |  |
| 2026-08-18 13:27 | agent | claude-sonnet-5 | thin | 34 chars |  |
| 2026-08-18 13:29 | agent | claude-sonnet-5 | ok | 151 chars |  |
| 2026-08-18 13:31 | general-purpose | claude-sonnet-5 | ok | 399 chars |  |
| 2026-08-18 14:18 | agent | claude-sonnet-5 | ok | 113 chars |  |
