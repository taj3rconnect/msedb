# MSEDB

Microsoft Email Dashboard — monitors M365 mailboxes, detects repetitive actions, creates rules on approval.

## Ports

| Service | Port | Domain |
|---------|------|--------|
| Frontend | 3010 | msedb.aptask.com |
| Backend | 8010 | - |
| MongoDB | 27020 | - |
| Redis | 6382 | - |

## Architecture

- Next.js (React + TS) frontend, Express.js backend
- Microsoft Graph API: `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`
- Auth: MSAL OAuth 2.0 authorization code grant
- All Graph calls: `https://graph.microsoft.com/v1.0/`
- No mailbox rule created without explicit user approval
- TypeScript strict mode across both frontend and backend
