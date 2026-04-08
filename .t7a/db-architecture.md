## Database Architecture Review — MSEDB

### Score: 62 / 100

14 models total. Core write-hot model is EmailEvent. Good: encrypted token storage (AES-GCM), TTL indexes, compound dedup index, evidence array validator. Bad: keep reading.

### Critical Findings

1. **MongoDB ZERO authentication** — `docker-compose.yml:79` — bind_ip_all, no --auth, port 27020 exposed
2. **N+1 query explosion in pattern analysis** — `patternEngine.ts:550-555` — getRecencyStats() per sender, 600+ DB round trips
3. **Unbounded distinct query as $nin filter** — `events.ts:90-97` — loads ALL deleted messageIds, appears in 3 places

### Medium Findings

4. AuditLog no TTL, no retention — Mixed details field, unbounded growth
5. Race condition in rule creation dedup — `rules.ts:157-189` — no atomic check-and-create
6. delete-by-sender loads ALL rules into memory — `rules.ts:871-872`
7. No transactions — pattern approve + audit + rule creation = 3 separate writes

### Index Recommendations

| Table/Collection | Suggested Index | Reason |
|-----------------|----------------|--------|
| EmailEvent | {messageId, timestamp: -1} | findOne({messageId}).sort({timestamp: -1}) in hot paths |
| AuditLog | {action, mailboxId, createdAt: -1} | reportService queries |
| EmailEvent | {userId, mailboxId, sender.email, eventType} | pattern engine queries |
| Rule | {userId, conditions.senderEmail} | dedup check, delete-by-sender |

### Redis Concerns

- noeviction with 384MB — when full ALL writes fail including BullMQ
- No key namespacing strategy
- Delta links have no TTL

### Backup & Recovery: 0/10

No mongodump, no volume backup, no PITR capability.

### Top 3 Recommendations

1. Add MongoDB authentication immediately
2. Fix noeviction Redis policy or increase memory
3. Eliminate N+1 in pattern analysis
