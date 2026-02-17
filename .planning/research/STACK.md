# Stack Research

**Domain:** Microsoft 365 Email Intelligence & Automation Portal
**Researched:** 2026-02-16
**Confidence:** HIGH

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Node.js | 22.x LTS (22.22.0+) | Runtime for backend services | Active LTS until Oct 2025, maintenance until Apr 2027. Node 20 EOL is Apr 2026 — too close for a greenfield project. Node 22 gives 14+ months of additional support and includes native fetch, test runner improvements, and better ESM support. | HIGH |
| Express.js | 5.2.x | HTTP framework | Express 5.2.1 is the current stable default on npm (since Mar 2025). It drops legacy cruft, improves security, and has an official LTS timeline. Express 4.x is entering maintenance mode. For a new project in 2026, use Express 5. | HIGH |
| TypeScript | 5.9.x | Type safety across front/backend | Latest stable is 5.9.3. TS 6.0 beta is out but use 5.9 for stability. The Go-based TS 7.0 compiler is experimental — avoid for production. TS 5.9 has excellent Node.js 22 and React 19 support. | HIGH |
| React | 19.x (19.2.4) | Frontend UI framework | React 19 is the current stable release. React 18 is now a prior major version. React 19 brings the compiler (automatic memoization), Actions API, Server Components readiness, and improved hooks. shadcn/ui and TanStack Query fully support React 19. Backward compatible with most React 18 code. | HIGH |
| Vite | 6.x (6.4.x) | Frontend build tooling | Vite 7.3.1 is latest stable, but use Vite 6.4.x for proven stability — it still receives security patches. Vite 6 has excellent React 19 + TypeScript 5.9 support, sub-second HMR, and wide plugin ecosystem. Avoid Vite 8 beta (Rolldown-powered) — still experimental. | MEDIUM |
| MongoDB | 7.0.x (7.0.28+) | Primary database for events, patterns, rules | MongoDB 7.0 is mature and production-proven. MongoDB 8 exists but 7.0 aligns with PRD specs and has excellent Mongoose 8 support. Docker image `mongo:7` is well-maintained. Provides change streams, time-series collection support, and compound wildcard indexes useful for email event queries. | HIGH |
| Redis | 7.4.x | Cache, job queue backing store, session store | Redis 7.4 is the latest stable 7.x release. Redis 8.x exists but introduced license changes (RSALv2/SSPLv1). Redis 7.4 is proven, BullMQ-compatible, and available as `redis:7-alpine` Docker image. The licensing for 7.4 is acceptable for self-hosted use. | HIGH |
| Docker + Docker Compose | Latest stable | Container orchestration | Standard for self-hosted multi-service deployments. Multi-stage builds, health checks, resource limits, named volumes per PRD. No orchestrator like K8s needed at this scale. | HIGH |

### Authentication & Graph API

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| @azure/msal-node | 3.x (3.8.7) | Azure AD OAuth 2.0 authentication | v3.8.7 is the current stable release (Feb 2026). The npm "latest" tag shows 5.0.4 but this appears to be a pre-release/beta version — the v3 line is what Microsoft's official tutorials and docs reference. Handles authorization code flow, token caching, silent refresh. Use v3 until v5 is officially GA. | MEDIUM |
| @azure/msal-react | 2.x | Frontend MSAL integration (if needed) | Handles redirect/popup auth flows in React. Only needed if doing auth in the SPA directly rather than routing through the backend. For this architecture (backend handles OAuth), optional. | LOW |
| @microsoft/microsoft-graph-client | 3.0.7 | Microsoft Graph API HTTP client | The stable, production-proven Graph client. @microsoft/msgraph-sdk (1.0.0-preview.79) is the newer Kiota-generated SDK but still in preview. For production use in 2026, stick with the 3.0.7 client which has extensive docs and examples. | HIGH |
| @microsoft/microsoft-graph-types | Latest | TypeScript type definitions for Graph API entities | Provides types for Message, MailFolder, MessageRule, Subscription, etc. Zero runtime cost — types only. Essential for TypeScript strict mode. | HIGH |

### State Management & Data Fetching (Frontend)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Zustand | 5.x (5.0.11) | Client-side state management | Minimal boilerplate, no Provider wrapper, excellent TypeScript support. At 5.5k+ npm dependents, it is the standard lightweight alternative to Redux for mid-sized React apps. Perfect for UI state (sidebar open, selected filters, user prefs). | HIGH |
| @tanstack/react-query | 5.x (5.90.21) | Server state management & caching | Industry standard for API data fetching, caching, background refetching. Handles loading/error states, pagination, optimistic updates. Combined with Zustand, eliminates need for Redux entirely. | HIGH |
| @tanstack/react-query-devtools | 5.x (5.91.3) | Dev tools for query debugging | Visualize query cache, inspect stale/fresh queries. Dev dependency only — tree-shaken in production. | HIGH |

### UI & Styling (Frontend)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Tailwind CSS | 4.x (4.1.18) | Utility-first CSS framework | Tailwind v4 released Jan 2025 — major performance upgrade (5x faster builds, 100x faster incremental). CSS-first configuration replaces tailwind.config.js. shadcn/ui has full v4 support. Zero-config with Vite. | HIGH |
| shadcn/ui | Latest CLI | Component library (copy-paste model) | Not an npm dependency — copies components into your project. Full Tailwind v4 + React 19 compatibility confirmed. Uses unified `radix-ui` package (no more individual @radix-ui/react-* packages). Components are fully customizable. The standard choice for Tailwind-based React dashboards in 2026. | HIGH |
| tw-animate-css | Latest | CSS animations for shadcn components | Replaces deprecated `tailwindcss-animate`. New default for shadcn/ui projects since Mar 2025. | HIGH |
| radix-ui | Latest | Accessible headless UI primitives | Underlying primitive library for shadcn/ui. Unified package (single dependency) since late 2025. | HIGH |
| Recharts | 2.x | Dashboard charts and visualizations | Declarative React charting library built on D3. Good for the heatmaps, activity charts, confidence bars, and action distribution visualizations specified in PRD. Lighter than Chart.js for React use cases. | MEDIUM |

### Routing (Frontend)

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| react-router | 7.x (7.13.0) | Client-side routing | v7 is stable since late 2024, actively maintained. In v7, import everything from `react-router` (no separate `react-router-dom`). Non-breaking upgrade from v6 patterns. For a dashboard SPA with ~10 routes, react-router is simpler than TanStack Router while being fully sufficient. | HIGH |

### Backend Libraries

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Mongoose | 8.x (8.19.x) | MongoDB ODM | Mongoose 8 is fully compatible with MongoDB 7.x. Mongoose 9 exists (Nov 2025) but 8.x still receives features/fixes until at least Feb 2026. For a new project, Mongoose 8 is safer — more community examples, stable API. Upgrade to 9 later when ecosystem stabilizes. | HIGH |
| BullMQ | 5.x (5.69.x) | Job queue and background processing | The standard Redis-backed job queue for Node.js. Handles webhook renewal, delta sync, pattern analysis, staging processor, daily digest, token refresh — all 7 background jobs from PRD. Use Job Schedulers API (v5.16.0+) for repeatable jobs — the older repeatable API is deprecated. | HIGH |
| ioredis | 5.x (5.9.3) | Redis client | BullMQ depends on ioredis internally. Use ioredis directly for any non-queue Redis operations (caching, session store). Despite node-redis being recommended by Redis Ltd for new projects, ioredis is required by BullMQ and has superior clustering/pipelining support. | HIGH |
| Socket.IO | 4.x (4.8.3) | Real-time WebSocket communication | Handles live dashboard updates, notification badges, activity feed streaming. Mature (11k+ dependents), works behind reverse proxies, has reconnection logic built-in. The v4 API is stable and well-documented. | HIGH |
| Winston | 3.x (3.19.0) | Structured logging | Industry standard Node.js logger. Supports JSON structured logging, multiple transports (file, console), log levels, and rotation. 26k+ dependents. | HIGH |
| Zod | 4.x (4.3.6) | Runtime schema validation | TypeScript-first validation for API request bodies, env vars, Graph API responses. Zero dependencies, 2kb gzipped. Zod 4 (Jun 2025) brought major performance improvements. Use for all API input validation instead of express-validator/joi. | HIGH |
| jose | 6.x (latest) | JWT signing and verification | Modern JOSE/JWT library. Preferred over jsonwebtoken (8+ years old, callback-based) for new projects. Supports ESM, all modern algorithms, JWE for token encryption. 24M+ weekly downloads. Used for session JWTs. | HIGH |
| helmet | 8.x | HTTP security headers | Wraps 15 security middlewares. Sets CSP, HSTS, X-Content-Type-Options, and more. Standard Express security middleware. Keep updated — security headers evolve. | HIGH |
| cors | 2.x | Cross-Origin Resource Sharing | Configure specific allowed origins (frontend URL, tunnel URL). Avoid wildcard origins — specify explicitly per OWASP guidance. | HIGH |
| express-rate-limit | 8.x (8.2.1) | API rate limiting | Protect endpoints from abuse. Use per-IP and per-user rate limits. Important for webhook endpoints and API routes. 1.9k dependents. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| ESLint | 9.x | Linting | Flat config format (eslint.config.js). Use @typescript-eslint for TS rules. |
| Prettier | 3.x | Code formatting | Integrate with ESLint via eslint-config-prettier. Tailwind plugin for class sorting. |
| Vitest | 3.x | Unit and integration testing | Vite-native test runner. Faster than Jest for Vite projects. Same config as Vite. |
| Supertest | Latest | HTTP integration testing | Test Express routes without starting server. Pairs with Vitest. |
| Docker Compose | v2 (built-in) | Local development orchestration | `docker compose` (v2 syntax, no hyphen). |
| nodemon | 3.x | Backend dev hot-reload | Auto-restart on file changes. Alternative: Node.js 22 `--watch` flag. |

---

## Installation

```bash
# ============================================
# BACKEND (Express + Node.js)
# ============================================

# Core
npm install express@5 mongoose@8 bullmq ioredis socket.io @azure/msal-node@3 @microsoft/microsoft-graph-client @microsoft/microsoft-graph-types zod jose helmet cors express-rate-limit winston

# Dev dependencies
npm install -D typescript@5.9 @types/node @types/express vitest supertest @types/cors nodemon eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier tsx

# ============================================
# FRONTEND (React + Vite)
# ============================================

# Core
npm install react@19 react-dom@19 react-router@7 zustand @tanstack/react-query recharts

# Dev dependencies
npm install -D vite@6 @vitejs/plugin-react typescript@5.9 @types/react @types/react-dom tailwindcss@4 @tanstack/react-query-devtools eslint prettier

# shadcn/ui (CLI-based — not installed via npm)
npx shadcn@latest init
# Then add components as needed:
npx shadcn@latest add button card dialog table badge toast tabs
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Runtime | Node.js 22 LTS | Node.js 20 LTS | Node 20 EOL is Apr 2026 — too close for a greenfield project starting now. Node 22 provides 14+ more months of support. |
| Runtime | Node.js 22 LTS | Bun / Deno | Smaller ecosystems, less battle-tested with MSAL/Graph SDKs. Docker images less standardized. Risk outweighs minimal performance gains. |
| Backend framework | Express 5 | Fastify | Express has wider MSAL/Graph SDK integration examples. Fastify is faster but Express's middleware ecosystem is unmatched for this use case. Express 5 closes the performance gap. |
| Backend framework | Express 5 | Hono | Hono is excellent for edge/serverless, not ideal for long-running Docker services with WebSocket, BullMQ workers, and complex middleware chains. |
| Frontend framework | React 19 + Vite | Next.js | MSEDB is a pure SPA dashboard — no SEO, no SSR needed. Next.js adds complexity (server components, file-based routing, build constraints) with no benefit for this use case. Vite is simpler and faster for SPAs. |
| Frontend framework | React 19 + Vite | React 18 + Vite | React 18 is a prior major version. React 19 is fully stable, shadcn/ui and TanStack Query support it, and the compiler provides free performance wins. No reason to start on an older version. |
| Database | MongoDB 7 | PostgreSQL | MongoDB's document model maps naturally to email events, patterns, and rules (deeply nested JSON). No complex joins needed. MongoDB change streams enable real-time pattern analysis. |
| Queue | BullMQ | Agenda.js | Agenda uses MongoDB — adding queue load to the DB. BullMQ + Redis is purpose-built for job queues with better reliability, retry logic, and the dedicated BullMQ Dashboard. |
| Queue | BullMQ | node-cron | node-cron is in-process only — no persistence, no retry, no distributed workers. BullMQ Job Schedulers handle repeatable jobs with Redis-backed durability. |
| State management | Zustand + TanStack Query | Redux Toolkit | Redux adds boilerplate (slices, reducers, dispatch) that Zustand eliminates. TanStack Query handles server state — Redux's main selling point is now unnecessary. |
| ORM | Mongoose 8 | Prisma | Prisma's MongoDB support is less mature than its PostgreSQL support. Mongoose is the standard MongoDB ODM with 15+ years of community investment. |
| Validation | Zod 4 | Joi / express-validator | Zod provides TypeScript type inference from schemas. Joi doesn't. express-validator is Express-coupled. Zod works everywhere (API, env vars, Graph responses). |
| JWT | jose | jsonwebtoken | jsonwebtoken is callback-based, 8+ years old, limited to JWS. jose supports ESM, modern algorithms, JWE (for encrypted tokens), and is actively maintained. |
| Build tool | Vite 6 | Webpack | Vite is 40x faster for dev builds. Webpack is legacy for new React projects in 2026. CRA (Webpack-based) is officially deprecated. |
| Routing | react-router 7 | TanStack Router | TanStack Router has better type safety but steeper learning curve. For ~10 dashboard routes, react-router 7 is simpler and sufficient. TanStack Router's advantages shine in larger apps. |
| Graph SDK | @microsoft/microsoft-graph-client 3.x | @microsoft/msgraph-sdk | The new Kiota-based SDK is still v1.0.0-preview.79 — not production-ready. Stick with the stable 3.x client until msgraph-sdk reaches GA. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Node.js 20 | EOL April 2026 — only 2 months of support remaining | Node.js 22 LTS (maintenance until Apr 2027) |
| Create React App (CRA) | Officially deprecated by React team (Feb 2025). No updates. | Vite 6 + @vitejs/plugin-react |
| Vite 8 beta | Rolldown-powered, still experimental, potential breaking changes | Vite 6.4.x (stable, security-patched) |
| React 18 | Prior major version. React 19 is stable with better performance (compiler) | React 19.2.x |
| Tailwind CSS 3 | v4 is a major performance upgrade. shadcn/ui defaults to v4 for new projects | Tailwind CSS 4.1.x |
| tailwindcss-animate | Deprecated by shadcn/ui (Mar 2025) | tw-animate-css |
| @microsoft/msgraph-sdk | Still in preview (1.0.0-preview.79). API may change. | @microsoft/microsoft-graph-client 3.0.7 |
| @azure/msal-node 5.x | Unclear GA status — may be pre-release. Docs reference 3.x | @azure/msal-node 3.8.7 |
| Bull (not BullMQ) | Legacy predecessor. BullMQ has better TypeScript, performance, and API | BullMQ 5.x |
| Agenda.js | Adds queue load to MongoDB. No dedicated queue infrastructure | BullMQ 5.x + Redis |
| node-cron / cron | In-process only, no persistence, no retry, no distributed execution | BullMQ Job Schedulers for all scheduled tasks |
| jsonwebtoken | Callback-based, no ESM, limited to JWS, aging codebase | jose (modern JOSE/JWT library) |
| Passport.js | Unnecessary abstraction for single-provider Azure AD auth. MSAL handles everything | @azure/msal-node directly |
| express-session (with server store) | Adds server-side session state. JWTs with Redis blacklist is more scalable for this architecture | jose + Redis token blacklist |
| Mongoose 9 | Released Nov 2025 — ecosystem still stabilizing. Fewer community examples | Mongoose 8.x (mature, MongoDB 7 compatible) |

---

## Stack Patterns by Variant

**If adding AI features in Phase 2 (Claude API for auto-responses):**
- Add a separate `msedb-ai` container on port 8012 (per PRD)
- Use BullMQ job queues to send AI tasks from backend to AI service
- Keep AI service stateless — it reads from MongoDB, calls Claude, writes results back
- Use Anthropic SDK for Node.js (`@anthropic-ai/sdk`)

**If scaling beyond 50 users (Phase 4 SaaS):**
- Add MongoDB replica set for read scaling (change `mongo:7` to 3-node replica set in Compose)
- Add Redis Sentinel or Cluster for HA
- Consider moving BullMQ workers to separate containers
- Evaluate adding a reverse proxy (Nginx/Traefik) in front of backend

**If webhook volume exceeds rate limits:**
- Implement Microsoft Graph batching ($batch endpoint) for delta queries
- Use BullMQ rate limiter on outbound Graph API calls
- Consider Application permissions (daemon flow) alongside delegated permissions for background reliability

---

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node.js 22.x | Express 5.2.x | Express 5 requires Node 18+. Node 22 fully supported. |
| Node.js 22.x | TypeScript 5.9.x | Native TS support improving in Node 22. Use tsx for dev, tsc for build. |
| Mongoose 8.x | MongoDB 7.x | Officially compatible per Mongoose compatibility docs. Uses MongoDB Node driver v6.x. |
| Mongoose 8.x | Node.js 22.x | Mongoose 8 supports Node 16+. |
| BullMQ 5.x | ioredis 5.x | BullMQ depends on ioredis internally. Version 5.x of both are compatible. |
| BullMQ 5.x | Redis 7.x | BullMQ supports Redis 6.2+. Redis 7.4 fully supported. |
| React 19.x | react-router 7.x | react-router 7 supports React 18+ and React 19 explicitly. |
| React 19.x | @tanstack/react-query 5.x | TanStack Query 5 supports React 18+ and React 19. |
| React 19.x | Zustand 5.x | Zustand 5 supports React 18+ and React 19. |
| Tailwind CSS 4.x | shadcn/ui (latest CLI) | Full compatibility confirmed. Uses @theme directive and tw-animate-css. |
| Tailwind CSS 4.x | Vite 6.x | Zero-config integration. Tailwind 4 PostCSS plugin works natively with Vite. |
| @azure/msal-node 3.x | @microsoft/microsoft-graph-client 3.x | Standard pairing. MSAL provides tokens, Graph client uses them for API calls. |
| Socket.IO 4.x | Express 5.x | Socket.IO attaches to HTTP server created from Express app. Compatible. |

---

## Docker Image Versions

| Service | Image | Tag | Size (approx) |
|---------|-------|-----|----------------|
| Frontend (build) | node | 22-alpine | ~180MB (builder only) |
| Frontend (runtime) | nginx | alpine | ~40MB |
| Backend | node | 22-alpine | ~180MB |
| MongoDB | mongo | 7 | ~700MB |
| Redis | redis | 7-alpine | ~30MB |

Use `node:22-alpine` for both frontend build and backend runtime stages. Alpine-based images are 3-5x smaller than Debian-based.

---

## Sources

- [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases) — Node 22 LTS status, EOL dates (HIGH confidence)
- [Express 5.1.0 Release Announcement](https://expressjs.com/2025/03/31/v5-1-latest-release.html) — Express 5 as npm default (HIGH confidence)
- [React Versions](https://react.dev/versions) — React 19.2.4 current stable (HIGH confidence)
- [Vite Releases](https://vite.dev/releases) — Vite 7.3.1 latest, Vite 6.4.x receiving patches (HIGH confidence)
- [Tailwind CSS v4.0 Announcement](https://tailwindcss.com/blog/tailwindcss-v4) — v4 performance improvements (HIGH confidence)
- [shadcn/ui Tailwind v4 Support](https://ui.shadcn.com/docs/tailwind-v4) — Full compatibility confirmed (HIGH confidence)
- [shadcn/ui Changelog](https://ui.shadcn.com/docs/changelog) — tw-animate-css replacing tailwindcss-animate (HIGH confidence)
- [@azure/msal-node npm](https://www.npmjs.com/package/@azure/msal-node) — v3.8.7 latest stable (MEDIUM confidence)
- [@microsoft/microsoft-graph-client npm](https://www.npmjs.com/package/@microsoft/microsoft-graph-client) — v3.0.7 stable (HIGH confidence)
- [@microsoft/msgraph-sdk npm](https://www.npmjs.com/package/@microsoft/msgraph-sdk) — v1.0.0-preview.79 still preview (HIGH confidence)
- [Mongoose Compatibility](https://mongoosejs.com/docs/compatibility.html) — Mongoose 8 + MongoDB 7 compatibility (HIGH confidence)
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers) — v5.16.0+ Job Schedulers API (HIGH confidence)
- [BullMQ npm](https://www.npmjs.com/package/bullmq) — v5.69.3 latest (HIGH confidence)
- [Zustand npm](https://www.npmjs.com/package/zustand) — v5.0.11 latest (HIGH confidence)
- [@tanstack/react-query npm](https://www.npmjs.com/package/@tanstack/react-query) — v5.90.21 latest (HIGH confidence)
- [react-router npm](https://www.npmjs.com/package/react-router) — v7.13.0 latest (HIGH confidence)
- [Socket.IO npm](https://www.npmjs.com/package/socket.io) — v4.8.3 latest (HIGH confidence)
- [Winston npm](https://www.npmjs.com/package/winston) — v3.19.0 latest (HIGH confidence)
- [Zod Release Notes](https://zod.dev/v4) — v4.3.6 latest (HIGH confidence)
- [ioredis npm](https://www.npmjs.com/package/ioredis) — v5.9.3 latest, required by BullMQ (HIGH confidence)
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) — v8.2.1 latest (HIGH confidence)
- [TypeScript npm](https://www.npmjs.com/package/typescript) — v5.9.3 latest stable (HIGH confidence)
- [MongoDB Docker Hub](https://hub.docker.com/_/mongo) — mongo:7 tag available (HIGH confidence)
- [Redis Docker Hub](https://hub.docker.com/_/redis) — redis:7-alpine tag available (HIGH confidence)

---

*Stack research for: Microsoft 365 Email Intelligence & Automation Portal (MSEDB)*
*Researched: 2026-02-16*
