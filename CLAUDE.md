# MSEDB

Microsoft Email Dashboard — monitors M365 mailboxes, detects repetitive actions, creates rules on approval.

## Infrastructure — DO NOT CHANGE

| Key | Value |
|-----|-------|
| **Server** | **DGX** |
| **Tunnel** | msedb (acdd721a) → **msedb.aptask.com** |
| **Docker subnet** | default bridge |
| **Registry** | See `~/claude/PORT_REGISTRY.json` for master port list |

## Ports — DO NOT CHANGE

| Service  | Host Port | Internal | Container | Notes |
|----------|-----------|----------|-----------|-------|
| Frontend | **3010**  | 8080     | msedb-frontend | React/Nginx |
| Backend  | **8010**  | 8010     | msedb-backend | Express |
| MongoDB  | **27020** | 27017    | msedb-mongo | mongo:7, db: msedb |
| Redis    | **6382**  | 6379     | msedb-redis | Redis 7 |
| Tunnel   | —         | —        | msedb-tunnel | cloudflare/cloudflared |

Shared: Uses AX1 Qdrant at port 6333.

## Architecture

- Next.js (React + TS) frontend, Express.js backend
- Microsoft Graph API: `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.ReadWrite`
- Auth: MSAL OAuth 2.0 authorization code grant
- All Graph calls: `https://graph.microsoft.com/v1.0/`
- No mailbox rule created without explicit user approval
- TypeScript strict mode across both frontend and backend
