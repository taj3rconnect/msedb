## Security Audit — MSEDB

### Score: 62 / 100

### CRITICAL Vulnerabilities

C1. **MongoDB zero auth** — docker-compose.yml — bind_ip_all, port 27020, MSAL token caches readable
C2. **Redis zero auth** — docker-compose.yml — port 6382, can inject BullMQ jobs
C3. **JWT/encryption secrets default to empty string** — config/index.ts:46-48 — forgeable tokens if env vars unset
C4. **Docker socket mounted** — docker-compose.yml:22 — container escape path

### HIGH Risk

H1. Rate limiter mounted AFTER routes — server.ts:127-128 — zero brute-force protection
H2. No secure flag on session cookie if NODE_ENV != production
H3. Deactivated users can still use valid JWT — no DB check in requireAuth
H4. Health endpoint leaks infrastructure details — routes/health.ts:98-118
H5. Webhook endpoint no request-origin validation beyond static clientState

### MEDIUM Risk

M1. No CSRF protection (mitigated by sameSite:lax)
M2. No CSP from nginx
M3. 24h JWT with no refresh/revocation
M4-M8. Various lower-severity issues

### OWASP Top 10

| # | Category | Status |
|---|----------|--------|
| A01 | Broken Access Control | PARTIAL |
| A02 | Cryptographic Failures | FAIL |
| A03 | Injection | PASS |
| A04 | Insecure Design | PARTIAL |
| A05 | Security Misconfiguration | FAIL |
| A06 | Vulnerable Components | PASS |
| A07 | Auth Failures | PARTIAL |
| A08 | Data Integrity Failures | PASS |
| A09 | Logging & Monitoring | PASS |
| A10 | SSRF | LOW RISK |

### Top 3 Recommendations

1. Add MongoDB and Redis authentication immediately
2. Move rate limiter registration BEFORE route mounting
3. Add startup validation for critical secrets
