# Performance Audit — MSEDB (2026-08-13)

## Findings

### PERF-01 · HIGH · perf · impact H / effort M · status: OPEN
**Where:** `backend/src/services/ruleEngine.ts:255–297`
**Claim:** Rule "Run Now" feature fetches all unread emails from Graph API then filters them client-side for sender, domain, subject, and body instead of using Graph's $filter parameter.
**Why it matters:** A mailbox with thousands of unread emails will load all of them into memory for application-level filtering, causing memory bloat, network waste, and latency on each rule run.
**Fix:** Move senderEmail, senderDomain, subjectContains, and bodyContains filtering into the Graph API $filter query parameter (line 255) instead of post-processing the full result set client-side (lines 265–297).
**Verifier:** `grep -n "filteredMessages = filteredMessages.filter" backend/src/services/ruleEngine.ts | wc -l` should return 0 after fix (currently returns 4 matches on lines 267, 276, 286, 294).
**Eligible for --fix:** no

### PERF-02 · LOW · perf · impact L / effort M · status: OPEN
**Where:** `backend/src/routes/admin.ts:194–204`
**Claim:** Admin health endpoint fetches all WebhookSubscription and Mailbox documents without pagination or limits, loading the entire collections into memory.
**Why it matters:** Instances with thousands of mailboxes or webhook subscriptions will see memory and latency spikes when admins check health status.
**Fix:** Add `.limit(1000)` to both queries and return pagination metadata so the endpoint can be paged if needed.
**Verifier:** `grep -A 5 "adminRouter.get.*health" backend/src/routes/admin.ts | grep -c "limit"` should return 2 after fix (currently returns 0).
**Eligible for --fix:** no

### PERF-03 · MEDIUM · perf · impact M / effort M · status: OPEN
**Where:** `backend/src/routes/admin.ts:406–409`
**Claim:** Admin bulk body prefetch endpoint fetches all unread arrived events without a limit, then loops over the entire result set (lines 414–435) to queue prefetch jobs.
**Why it matters:** Mailboxes with millions of unread emails will load them all into memory and queue millions of jobs at once, potentially overwhelming the job system and causing OOM crashes.
**Fix:** Add `.limit(10000)` to the EmailEvent.find() call and inform the caller how many were processed vs. how many exist total (add pagination support).
**Verifier:** `grep -B 3 "EmailEvent.find" backend/src/routes/admin.ts | tail -1 | grep -c "limit"` should return 1 after fix (currently returns 0).
**Eligible for --fix:** no

## Checks

```csv
check_id,dim,status,score,max,note
PERF-01,perf,FAIL,0,3,client-side email filtering on Rule Run Now
PERF-02,perf,FAIL,0,1,unbounded WebhookSubscription + Mailbox load on admin health
PERF-03,perf,FAIL,0,2,unbounded EmailEvent load on admin bulk prefetch
PERF-FRONTEND-CACHE,perf,PASS,1,1,React Query cacheTime properly configured at app level (30s default)
PERF-PAGINATION,perf,PASS,2,2,Frontend pages use pagination (50–100 items max per page)
PERF-LODASH,perf,PASS,1,1,No full lodash imports; bundle-efficient
PERF-MEMOIZATION,perf,PASS,2,2,useCallback + useMemo used appropriately in hot-path components
```
