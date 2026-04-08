## Performance Review — MSEDB

### Score: 58 / 100

### Critical Performance Issues

1. **N+1 Redis calls in folder resolution** — events.ts:133-161 — 150+ sequential redis.get() per request
2. **Pattern engine individual aggregations per sender** — patternEngine.ts:550-555 — 300 sequential aggregations daily
3. **Delta sync sequential processing** — deltaService.ts:139-227 — no batching
4. **No lazy loading on any frontend route** — App.tsx:11-23 — all 14 pages in initial bundle
5. **No static asset caching in nginx** — zero Cache-Control headers

### Performance Hotspots

| Location | Issue | Severity |
|---|---|---|
| events.ts:133-161 | N+1 Redis calls in folder filter | CRITICAL |
| patternEngine.ts:550 | getRecencyStats() in nested loop | CRITICAL |
| deltaService.ts:139-227 | Sequential message processing | HIGH |
| App.tsx:11-23 | Zero code splitting | HIGH |
| nginx.conf | No cache headers | HIGH |
| events.ts:88-98 | excludeDeleted distinct query | MEDIUM |
| dashboard.ts:31-83 | 5 serial DB queries, no caching | MEDIUM |

### Quick Wins

1. Add Cache-Control for hashed assets in nginx (5 min)
2. Lazy-load page components in App.tsx
3. Batch Redis folder lookups with mget()
4. Add standalone messageId index to EmailEvent
5. Cache dashboard stats in Redis for 30s

### Top 3 Recommendations

1. Implement code splitting and lazy loading
2. Batch pattern engine queries into single aggregation
3. Parallelize delta sync with bounded concurrency
