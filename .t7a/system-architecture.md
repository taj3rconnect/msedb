## System Architecture Review — MSEDB

### Score: 58 / 100

### Architecture Diagram

```
                    Internet
                       |
                 Cloudflare Tunnel
                   (host-level)
                       |
          +------------+-------------+
          |                          |
   [msedb-frontend]          [msedb-backend]
    nginx:8080/8081            Express:8010
    (React SPA build)          |
          |                    +-- Socket.IO (ws)
          |                    +-- BullMQ (11 queues, 11 workers)
          |                    +-- MSAL OAuth 2.0
          |                    +-- Microsoft Graph API
          |                    |
          +-------proxy--------+
                       |
          +------------+-------------+
          |                          |
    [msedb-mongo]             [msedb-redis]
     MongoDB 7:27020           Redis 7:6382
                       |
              [AX1 Qdrant:6333]
              [Ollama:11434]
```

### Critical Findings

1. **Docker Socket mounted into backend container** — `docker-compose.yml:22`, `tunnelService.ts:9` — Container escape vector
2. **Rate Limiters mounted AFTER routes** — `server.ts:127-128` — They never fire
3. **No fetch timeout on Graph API calls** — `graphClient.ts:48` — Hung calls starve BullMQ workers

### High Severity

4. God File: `routes/mailbox.ts` at 1,805 lines
5. Hardcoded IP in auth middleware audience — `auth/middleware.ts:57`
6. Single test file for entire backend
7. `process.env.ANTHROPIC_API_KEY` accessed directly in route — `events.ts:392`

### Medium Severity

8. MongoDB exposed without auth (27020)
9. Redis exposed without auth (6382)
10. Swallowed `.catch(() => {})` errors in mailbox.ts
11. No request timeouts on Express
12. Frontend Dockerfile inconsistency
13. Mongoose pool size 50 excessive

### Tech Debt Register

| Item | File | Severity | Effort |
|------|------|----------|--------|
| Rate limiters after routes | server.ts:127-128 | Critical | 30 min |
| Docker socket mount | docker-compose.yml:22 | Critical | 2-4 hrs |
| No fetch timeout | graphClient.ts:48 | High | 1 hr |
| God file mailbox.ts | routes/mailbox.ts | High | 1-2 days |
| God component InboxPage | pages/InboxPage.tsx | High | 1-2 days |
| Hardcoded IP audience | auth/middleware.ts:57 | High | 15 min |
| env var outside config | routes/events.ts:392 | Medium | 10 min |
| MongoDB no auth | docker-compose.yml:68 | Medium | 1 hr |
| Redis no auth | docker-compose.yml:89 | Medium | 30 min |
| Swallowed errors | routes/mailbox.ts | Medium | 30 min |
| No request logging | server.ts | Medium | 1 hr |
| Duplicated nginx blocks | nginx.conf | Low | 1 hr |
| 1 test file | services/__tests__/ | High | Ongoing |
