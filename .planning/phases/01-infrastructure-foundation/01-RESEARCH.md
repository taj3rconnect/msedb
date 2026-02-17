# Phase 1: Infrastructure Foundation - Research

**Researched:** 2026-02-16
**Domain:** Docker containerization, database/cache persistence, background job infrastructure, security hardening, webhook ingress
**Confidence:** HIGH

## Summary

Phase 1 establishes the entire runtime infrastructure for MSEDB: a Docker Compose stack with four containers (backend, frontend shell, MongoDB, Redis), all persistence layer connections, BullMQ background job scaffolding, security hardening (encryption, rate limiting, non-root containers), health endpoints, and Cloudflare Tunnel for webhook ingress.

The stack has been updated from the original PRD: Node.js 22 (not 20), Express 5 (not 4), React 19 (not 18), Tailwind 4 (not 3), Mongoose 8 (not 6/7). Express 5 is now the default npm version (5.2.x) and brings native async error handling. BullMQ 5 has deprecated the old `repeat` API in favor of `upsertJobScheduler` (since v5.16.0). Tailwind 4 uses CSS-first configuration with `@theme` instead of `tailwind.config.js`. The Docker Compose `version` field is obsolete and should be omitted.

**Primary recommendation:** Build the Docker Compose stack with the updated versions, use `noeviction` Redis policy from day one, implement all Mongoose models with compound indexes in Phase 1 so Phase 2 can immediately start writing auth data, and configure Cloudflare Tunnel with a WAF skip rule for the webhook path.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Fully containerized Docker Compose stack -- frontend (React 19 + Vite + nginx), backend (Node.js 22 + Express 5), MongoDB 7, Redis 7. Resource limits: 5 CPU / 5GB RAM total across 4 containers | Docker Compose deploy.resources.limits supports cpus/memory. Multi-stage Dockerfiles with node:22-alpine, non-root users via addgroup/adduser, tini for PID 1. Version field is obsolete -- omit it. |
| INFR-02 | Cloudflare Tunnel for public HTTPS webhook endpoint. Bot protection configured to allow Graph API webhook POSTs on /webhooks/graph path | Cloudflare Tunnel config.yml with ingress rules routing hostname to localhost:8010. Free plan Bot Fight Mode cannot be bypassed by WAF rules -- must either disable Bot Fight Mode or use Pro plan with WAF Skip rule for the webhook path. |
| INFR-03 | Background jobs via BullMQ with Redis (noeviction policy): webhook renewal (2h), delta sync (15m), pattern analysis (daily 2AM), staging processor (30m), token refresh (45m). removeOnComplete/removeOnFail with age limits on all queues | BullMQ 5 requires Redis 7+ with maxmemory-policy=noeviction. Use new `upsertJobScheduler` API (not deprecated `repeat`). removeOnComplete/removeOnFail accept `{ age: seconds, count: number }` objects. Workers need `maxRetriesPerRequest: null` on Redis connection. |
| INFR-04 | Security hardening -- AES-256-GCM token encryption, user data isolation at query level, rate limiting on all endpoints (5/min auth, 100/min API), non-root containers, $select on all Graph API calls | Node.js crypto module provides createCipheriv/createDecipheriv for AES-256-GCM with 12-byte IV and auth tag. express-rate-limit v7 with rate-limit-redis for distributed rate limiting. Non-root via Dockerfile USER directive. |
| INFR-05 | Health endpoints reporting container status, MongoDB connectivity, Redis connectivity, webhook subscription status per mailbox, token health per user | Express 5 endpoint at /api/health that checks mongoose.connection.readyState, Redis PING, process uptime. Docker HEALTHCHECK uses curl/wget against this endpoint. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.x | HTTP framework | Now the default on npm (since March 2025). Native async error handling eliminates try/catch boilerplate. Requires Node 18+. |
| mongoose | 8.x | MongoDB ODM | Active support through Feb 2026. Mongoose 9 released Nov 2025 but introduces breaking changes (no `next()` in pre middleware, `FilterQuery` renamed to `QueryFilter`). Stick with 8.x for stability since 9.x is very new. |
| bullmq | 5.x | Background job queues | Standard for Redis-backed job processing in Node.js. Requires Redis 7+ with noeviction policy. New Job Scheduler API (v5.16.0+) replaces deprecated repeatable jobs API. |
| ioredis | 5.x | Redis client | Required by BullMQ. Provides cluster support, pipeline, pub/sub. Used for both BullMQ connections and direct Redis operations. |
| winston | 3.x | Structured logging | Standard Node.js logger. JSON format for machine-readable logs, multiple transports (console + file). |
| express-rate-limit | 7.x | API rate limiting | Standard Express rate limiting middleware. Per-route configuration. |
| rate-limit-redis | 4.x | Redis store for rate limiter | Persistent rate limiting across container restarts using Redis. Uses ioredis `client.call()`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tailwindcss/vite | 4.x | Tailwind CSS Vite plugin | Frontend build -- replaces PostCSS-based setup from Tailwind 3 |
| tini | system pkg | PID 1 init for containers | Always -- prevents zombie processes in containers |
| helmet | 8.x | HTTP security headers | Apply to all Express responses |
| cors | 2.x | CORS middleware | Configure for frontend origin |
| compression | 1.x | Response compression | Gzip/Brotli for API responses |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mongoose 8 | Mongoose 9 | 9.x removes `next()` from pre middleware, renames `FilterQuery` to `QueryFilter`, breaks update pipelines by default. Too new (Nov 2025) for a greenfield project -- risk of ecosystem incompatibility. Upgrade path is straightforward when ready. |
| express-rate-limit | rate-limiter-flexible | rate-limiter-flexible is more powerful but express-rate-limit is simpler, purpose-built for Express, and has a maintained Redis store. |
| Winston | Pino | Pino is faster but Winston has wider ecosystem support and easier configuration for multiple transports. |

**Installation (backend):**
```bash
npm install express@5 mongoose@8 bullmq@5 ioredis@5 winston@3 express-rate-limit@7 rate-limit-redis@4 helmet cors compression dotenv
npm install -D typescript @types/express @types/node @types/cors @types/compression
```

**Installation (frontend):**
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install @tailwindcss/vite
npx shadcn@latest init
```

## Architecture Patterns

### Recommended Project Structure

```
MSEDB/
├── docker-compose.yml              # No version field (obsolete)
├── .env.example
├── .env                            # Gitignored
├── backend/
│   ├── Dockerfile                  # Multi-stage, non-root, tini
│   ├── .dockerignore
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts               # Express 5 app entry
│       ├── config/
│       │   ├── index.ts            # Env var loading with defaults
│       │   ├── database.ts         # Mongoose connection with retry
│       │   ├── redis.ts            # ioredis connection
│       │   └── logger.ts           # Winston setup
│       ├── models/                 # All Mongoose schemas
│       │   ├── index.ts            # Barrel export, model registration
│       │   ├── User.ts
│       │   ├── EmailEvent.ts
│       │   ├── Pattern.ts
│       │   ├── Rule.ts
│       │   ├── StagedEmail.ts
│       │   ├── AuditLog.ts
│       │   ├── Notification.ts
│       │   ├── WebhookSubscription.ts
│       │   └── Mailbox.ts          # Multi-mailbox per user
│       ├── jobs/
│       │   ├── queues.ts           # Queue + Worker definitions
│       │   └── schedulers.ts       # upsertJobScheduler calls
│       ├── middleware/
│       │   ├── rateLimiter.ts      # Per-route rate limits
│       │   ├── errorHandler.ts     # Global error handler
│       │   └── security.ts         # helmet, cors, compression
│       ├── routes/
│       │   ├── health.ts           # /api/health endpoint
│       │   └── webhooks.ts         # /webhooks/graph stub
│       └── utils/
│           ├── encryption.ts       # AES-256-GCM encrypt/decrypt
│           └── helpers.ts
├── frontend/
│   ├── Dockerfile                  # Multi-stage: vite build -> nginx
│   ├── .dockerignore
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 # Minimal shell for Phase 1
│       └── app.css                 # @import "tailwindcss" (v4 style)
└── scripts/
    └── seed.ts
```

### Pattern 1: Mongoose Connection with Retry

**What:** Connect to MongoDB with exponential backoff retry on initial connection failure.
**When to use:** Always -- container startup order is not guaranteed even with depends_on.

```typescript
// Source: https://mongoosejs.com/docs/connections.html
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://msedb-mongo:27017/msedb';

export async function connectDatabase(): Promise<void> {
  const MAX_RETRIES = 10;
  const BASE_DELAY = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(MONGODB_URI, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
      });
      console.log('MongoDB connected');

      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB disconnected. Mongoose will auto-reconnect.');
      });

      return;
    } catch (error) {
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), 30000);
      console.warn(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed. Retrying in ${delay}ms...`);
      if (attempt === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Pattern 2: BullMQ Job Scheduler (New API)

**What:** Define recurring jobs using the new `upsertJobScheduler` API instead of deprecated `repeat` option.
**When to use:** All cron/interval-based background jobs.

```typescript
// Source: https://docs.bullmq.io/guide/job-schedulers
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: 'msedb-redis',
  port: 6379,
  maxRetriesPerRequest: null,  // Required for BullMQ workers
  enableOfflineQueue: false,   // Fail fast for Queue instances
});

// Define queue
const webhookRenewalQueue = new Queue('webhook-renewal', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 100 },   // Keep 1h or 100 jobs
    removeOnFail: { age: 86400, count: 500 },       // Keep 24h or 500 failed
  },
});

// Register job scheduler (replaces deprecated repeat API)
await webhookRenewalQueue.upsertJobScheduler(
  'webhook-renewal-scheduler',       // Scheduler ID (idempotent upsert)
  { pattern: '0 */2 * * *' },        // Every 2 hours
  {
    name: 'renew-webhooks',
    data: {},
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  },
);

// Define worker (separate connection recommended)
const workerConnection = new IORedis({
  host: 'msedb-redis',
  port: 6379,
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'webhook-renewal',
  async (job) => {
    // Job processing logic
    console.log('Processing webhook renewal:', job.id);
  },
  { connection: workerConnection },
);

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
```

### Pattern 3: AES-256-GCM Token Encryption

**What:** Encrypt/decrypt OAuth tokens at rest using Node.js built-in crypto.
**When to use:** Storing any sensitive tokens in MongoDB.

```typescript
// Source: Node.js crypto documentation + https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

export function encrypt(text: string, keyHex: string): { encrypted: string; iv: string; tag: string } {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decrypt(encrypted: string, ivHex: string, tagHex: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Pattern 4: Express 5 Health Endpoint

**What:** Health check endpoint that reports subsystem status.
**When to use:** Docker HEALTHCHECK and monitoring.

```typescript
// Express 5: async handlers automatically propagate errors
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';

const router = Router();

router.get('/api/health', async (req: Request, res: Response) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  let redisStatus = 'disconnected';
  try {
    const redis = req.app.get('redis') as Redis;
    const pong = await redis.ping();
    redisStatus = pong === 'PONG' ? 'connected' : 'error';
  } catch {
    redisStatus = 'error';
  }

  const healthy = mongoStatus === 'connected' && redisStatus === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
  });
});
```

### Pattern 5: Rate Limiting with Redis Store

**What:** Per-route rate limiting backed by Redis for persistence across restarts.
**When to use:** All API routes, with stricter limits on auth routes.

```typescript
// Source: https://github.com/express-rate-limit/rate-limit-redis
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import IORedis from 'ioredis';

const redisClient = new IORedis({ host: 'msedb-redis', port: 6379 });

// Strict limit for auth endpoints: 5 requests per minute
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (command: string, ...args: string[]) =>
      redisClient.call(command, ...args) as Promise<RedisReply>,
    prefix: 'rl:auth:',
  }),
});

// Standard limit for API endpoints: 100 requests per minute
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (command: string, ...args: string[]) =>
      redisClient.call(command, ...args) as Promise<RedisReply>,
    prefix: 'rl:api:',
  }),
});
```

### Anti-Patterns to Avoid

- **Redis `allkeys-lru` policy:** Silently evicts BullMQ job keys, causing lost jobs and broken queue state. Always use `noeviction`.
- **Blocking webhook handler:** The webhook endpoint MUST return 202 within 3 seconds. Never make Graph API calls in the handler. Queue processing via BullMQ.
- **Docker Compose `version` field:** Obsolete since Compose v2 (2022). Including it generates warnings. Omit entirely.
- **`new Buffer()` constructor:** Deprecated. Use `Buffer.from()` and `Buffer.alloc()` instead.
- **Express 4 error patterns:** Express 5 auto-propagates async errors. Do NOT wrap every route in try/catch or use `express-async-errors` -- it is built in now.
- **BullMQ `repeat` option:** Deprecated since v5.16.0. Use `upsertJobScheduler` instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom middleware with in-memory counters | express-rate-limit + rate-limit-redis | Handles edge cases (sliding windows, distributed state, header standards), survives restarts |
| Job scheduling | setInterval/setTimeout cron | BullMQ upsertJobScheduler | Handles retries, persistence, stalled job recovery, distributed workers, graceful shutdown |
| Encryption | Custom crypto wrapper | Node.js built-in `crypto` with AES-256-GCM pattern | Standard algorithm, auth tag prevents tampering, well-understood security properties |
| Docker init process | Bare `CMD ["node", "server.js"]` | tini as PID 1 via `ENTRYPOINT ["/sbin/tini", "--"]` | Prevents zombie processes, handles signals correctly |
| Health checks | Simple ping endpoint | Structured health endpoint checking all subsystems | Docker, load balancers, and monitoring tools need subsystem-level health data |
| HTTP security headers | Manual header setting | helmet middleware | Covers 11+ security headers with sensible defaults |

**Key insight:** Infrastructure code is deceptively complex. Rate limiting alone has sliding window edge cases, distributed state synchronization, and HTTP header standards. Use maintained libraries.

## Common Pitfalls

### Pitfall 1: Redis Eviction Policy Destroys BullMQ State

**What goes wrong:** BullMQ relies on specific Redis keys for job state. If Redis uses `allkeys-lru` and hits memory limit, it evicts job keys, corrupting queue state silently.
**Why it happens:** The PRD's original docker-compose.yml uses `--maxmemory-policy allkeys-lru`. This is wrong for BullMQ.
**How to avoid:** Set `--maxmemory-policy noeviction` in Redis container command. BullMQ actively checks and warns at startup if this is misconfigured.
**Warning signs:** Jobs disappear from queues, repeatable jobs stop firing, BullMQ logs eviction warnings.

### Pitfall 2: Docker Compose Resource Limits Ignored Without Engine Support

**What goes wrong:** `deploy.resources.limits` in Compose may be silently ignored if Docker Engine is not configured for cgroup support.
**Why it happens:** On some Linux installations, cgroup v2 is not fully enabled, and `docker compose` (v2) may not enforce limits without `--compatibility` flag in some older versions.
**How to avoid:** Verify with `docker stats` after starting containers. Confirm CPU and memory limits appear. Test with `stress` inside container if needed.
**Warning signs:** `docker stats` shows no memory limit, container uses more resources than specified.

### Pitfall 3: Mongoose Connection Buffering Masks Failures

**What goes wrong:** Mongoose buffers operations when disconnected by default. Code appears to work but operations queue in memory and eventually fail.
**Why it happens:** `bufferCommands: true` is the default. Operations silently queue until connection is established or times out.
**How to avoid:** In production, consider `mongoose.set('bufferCommands', false)` to fail fast. Always await the connection before starting the Express server.
**Warning signs:** Requests hang for `serverSelectionTimeoutMS` before failing. Memory grows during MongoDB outages.

### Pitfall 4: Express 5 Breaking Changes Cause Silent Failures

**What goes wrong:** Express 5 changes route syntax (`/*splat` not `/*`), removes `req.param()`, changes `res.redirect()` argument order, and makes `req.query` read-only.
**Why it happens:** Express 5 is a major version bump with 20+ breaking changes. Examples from Express 4 tutorials silently fail.
**How to avoid:** Reference the official migration guide. Use codemods: `npx codemod@latest @expressjs/v5-migration-recipe`. Test every route.
**Warning signs:** 404 on routes that should match, undefined values from `req.param()`, redirect going to wrong URL.

### Pitfall 5: Cloudflare Bot Protection Blocks Webhooks

**What goes wrong:** Cloudflare Bot Fight Mode challenges or blocks Microsoft Graph webhook POST requests, which are automated server-to-server calls that cannot solve challenges.
**Why it happens:** Bot Fight Mode is enabled by default on Cloudflare zones. Free plan Bot Fight Mode cannot be bypassed by WAF custom rules.
**How to avoid:** On Free plan: disable Bot Fight Mode entirely for the zone. On Pro+ plan: create WAF custom rule with Skip action for `http.request.uri.path eq "/webhooks/graph"`. Verify with a test POST to the webhook URL.
**Warning signs:** Graph webhook subscriptions fail validation. Webhook notifications return 403. Subscription creation returns error.

### Pitfall 6: BullMQ Worker Connection Must Set maxRetriesPerRequest to null

**What goes wrong:** BullMQ workers throw exceptions and stop processing jobs.
**Why it happens:** ioredis defaults `maxRetriesPerRequest` to 20, but BullMQ workers need infinite retries for long-running blocking operations.
**How to avoid:** Always create Worker connections with `maxRetriesPerRequest: null`. BullMQ defaults to this internally but warns if you override it.
**Warning signs:** Worker error events fire with "Max retries per request limit reached" messages.

## Code Examples

Verified patterns from official sources:

### Docker Compose Service Definition (No Version Field)

```yaml
# Source: Docker Compose Specification (2025+)
# docker-compose.yml -- NO version field
services:
  msedb-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: msedb-backend
    ports:
      - "8010:8010"
    env_file:
      - .env
    depends_on:
      msedb-mongo:
        condition: service_healthy
      msedb-redis:
        condition: service_healthy
    networks:
      - msedb-network
    volumes:
      - msedb-logs:/app/logs
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8010/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  msedb-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: msedb-frontend
    ports:
      - "3010:80"
    depends_on:
      msedb-backend:
        condition: service_healthy
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80"]
      interval: 30s
      timeout: 5s
      retries: 3

  msedb-mongo:
    image: mongo:7
    container_name: msedb-mongo
    ports:
      - "27020:27017"
    volumes:
      - msedb-mongo-data:/data/db
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
    command: ["mongod", "--bind_ip_all"]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  msedb-redis:
    image: redis:7-alpine
    container_name: msedb-redis
    ports:
      - "6382:6379"
    volumes:
      - msedb-redis-data:/data
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "384mb", "--maxmemory-policy", "noeviction"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  msedb-network:
    driver: bridge
    name: msedb-network

volumes:
  msedb-mongo-data:
    name: msedb-mongo-data
  msedb-redis-data:
    name: msedb-redis-data
  msedb-logs:
    name: msedb-logs
```

### Backend Dockerfile (Node.js 22 Multi-Stage)

```dockerfile
# Source: Docker + Node.js best practices 2025
# backend/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache tini wget
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
RUN mkdir -p /app/logs && chown appuser:appgroup /app/logs
USER appuser
EXPOSE 8010
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

### Frontend Dockerfile (Vite Build -> nginx)

```dockerfile
# Source: Docker + Vite best practices 2025
# frontend/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache wget
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Redis Configuration for BullMQ

```bash
# Source: https://docs.bullmq.io/guide/going-to-production
# In docker-compose.yml command:
redis-server --appendonly yes --maxmemory 384mb --maxmemory-policy noeviction
```

Key settings:
- `--appendonly yes`: AOF persistence for durability
- `--maxmemory 384mb`: Leave headroom within 512MB container limit for Redis overhead
- `--maxmemory-policy noeviction`: CRITICAL for BullMQ -- never evict keys

### BullMQ All Job Schedulers

```typescript
// Source: https://docs.bullmq.io/guide/job-schedulers
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'msedb-redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

const defaultJobOpts = {
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 86400, count: 1000 },
};

// Create all queues
const queues = {
  webhookRenewal: new Queue('webhook-renewal', { connection, defaultJobOptions: defaultJobOpts }),
  deltaSync: new Queue('delta-sync', { connection, defaultJobOptions: defaultJobOpts }),
  patternAnalysis: new Queue('pattern-analysis', { connection, defaultJobOptions: defaultJobOpts }),
  stagingProcessor: new Queue('staging-processor', { connection, defaultJobOptions: defaultJobOpts }),
  tokenRefresh: new Queue('token-refresh', { connection, defaultJobOptions: defaultJobOpts }),
};

// Register all schedulers
export async function initializeSchedulers(): Promise<void> {
  await queues.webhookRenewal.upsertJobScheduler(
    'webhook-renewal-schedule',
    { pattern: '0 */2 * * *' },         // Every 2 hours
    { name: 'renew-webhooks', data: {} }
  );

  await queues.deltaSync.upsertJobScheduler(
    'delta-sync-schedule',
    { every: 15 * 60 * 1000 },           // Every 15 minutes
    { name: 'run-delta-sync', data: {} }
  );

  await queues.patternAnalysis.upsertJobScheduler(
    'pattern-analysis-schedule',
    { pattern: '0 2 * * *' },             // Daily at 2 AM
    { name: 'analyze-patterns', data: {} }
  );

  await queues.stagingProcessor.upsertJobScheduler(
    'staging-processor-schedule',
    { every: 30 * 60 * 1000 },            // Every 30 minutes
    { name: 'process-staging', data: {} }
  );

  await queues.tokenRefresh.upsertJobScheduler(
    'token-refresh-schedule',
    { every: 45 * 60 * 1000 },            // Every 45 minutes
    { name: 'refresh-tokens', data: {} }
  );
}
```

### Mongoose Model with Compound Indexes (TypeScript)

```typescript
// Source: https://mongoosejs.com/docs/8.x/docs/guide.html
import { Schema, model, Document, Types } from 'mongoose';

interface IEmailEvent extends Document {
  userId: Types.ObjectId;
  mailboxId: Types.ObjectId;
  messageId: string;
  internetMessageId?: string;
  eventType: 'arrived' | 'deleted' | 'moved' | 'read' | 'flagged' | 'categorized';
  timestamp: Date;
  sender: {
    name?: string;
    email: string;
    domain: string;
  };
  subject?: string;
  subjectNormalized?: string;
  receivedAt?: Date;
  timeToAction?: number;
  fromFolder?: string;
  toFolder?: string;
  importance: 'low' | 'normal' | 'high';
  hasAttachments: boolean;
  conversationId?: string;
  categories: string[];
  isRead: boolean;
  metadata: {
    hasListUnsubscribe?: boolean;
    isNewsletter?: boolean;
    isAutomated?: boolean;
    automatedByRule?: Types.ObjectId;
  };
}

const emailEventSchema = new Schema<IEmailEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true },
    messageId: { type: String, required: true },
    internetMessageId: String,
    eventType: {
      type: String,
      enum: ['arrived', 'deleted', 'moved', 'read', 'flagged', 'categorized'],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    sender: {
      name: String,
      email: String,
      domain: String,
    },
    subject: String,
    subjectNormalized: String,
    receivedAt: Date,
    timeToAction: Number,
    fromFolder: String,
    toFolder: String,
    importance: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    hasAttachments: { type: Boolean, default: false },
    conversationId: String,
    categories: [String],
    isRead: { type: Boolean, default: false },
    metadata: {
      hasListUnsubscribe: Boolean,
      isNewsletter: Boolean,
      isAutomated: Boolean,
      automatedByRule: { type: Schema.Types.ObjectId, ref: 'Rule' },
    },
  },
  { timestamps: true }
);

// Compound indexes for query performance
emailEventSchema.index({ userId: 1, 'sender.domain': 1, timestamp: -1 });
emailEventSchema.index({ userId: 1, eventType: 1, timestamp: -1 });
emailEventSchema.index({ userId: 1, mailboxId: 1, messageId: 1, eventType: 1 }, { unique: true }); // Dedup
emailEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90-day TTL

export const EmailEvent = model<IEmailEvent>('EmailEvent', emailEventSchema);
```

### Winston Logger Configuration

```typescript
// Source: https://github.com/winstonjs/winston
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'msedb-backend' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(winston.format.colorize(), winston.format.simple())
        : winston.format.json(),
    }),
    new winston.transports.File({
      filename: '/app/logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: '/app/logs/combined.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
  ],
});

export default logger;
```

### Cloudflare Tunnel Configuration

```yaml
# Source: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
# /etc/cloudflared/config.yml
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  # MSEDB Frontend
  - hostname: msedb.yourdomain.com
    service: http://localhost:3010

  # MSEDB API (includes webhook endpoint)
  - hostname: msedb-api.yourdomain.com
    service: http://localhost:8010

  # Catch-all (required)
  - service: http_status:404
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `version: '3.8'` in docker-compose.yml | Omit version field entirely | Compose v2 (2022) | Version field is obsolete, generates warnings |
| Express 4 with `express-async-errors` | Express 5 native async error handling | Express 5.0 (Oct 2024) | No need for try/catch wrappers or async-errors package |
| BullMQ `queue.add(name, data, { repeat: {...} })` | `queue.upsertJobScheduler(id, repeatOpts, template)` | BullMQ 5.16.0 (2025) | More robust, idempotent upsert, proper scheduler lifecycle |
| `tailwind.config.js` + PostCSS | `@import "tailwindcss"` + `@tailwindcss/vite` plugin | Tailwind 4.0 (Jan 2025) | CSS-first config, zero-config content detection, faster builds |
| `new Buffer()` | `Buffer.from()` / `Buffer.alloc()` | Node.js 10+ (2018) | Security: prevents uninitialized memory exposure |
| Express 4 `app.get('/*', ...)` | Express 5 `app.get('/*splat', ...)` | Express 5.0 (Oct 2024) | Wildcards must be named in route patterns |
| Mongoose 7 `findOneAndRemove()` | Mongoose 8 `findOneAndDelete()` | Mongoose 8 (Oct 2023) | Removed deprecated alias |

**Deprecated/outdated:**
- Express 4: Still receives security patches but Express 5 is now the default on npm
- BullMQ `repeat` option: Deprecated since v5.16.0, replaced by Job Schedulers
- Tailwind CSS `tailwind.config.js`: Still works via `@config` directive but CSS-first is recommended
- Docker Compose `version` field: Ignored by Compose v2+, generates warnings

## Open Questions

1. **Mongoose 8 vs Mongoose 9**
   - What we know: Mongoose 8 active support ends around Feb 2026. Mongoose 9 released Nov 2025 with breaking changes (no `next()` in pre middleware, `FilterQuery` -> `QueryFilter`, update pipelines disallowed by default).
   - What's unclear: Whether ecosystem libraries (msal ICachePlugin, etc.) are compatible with Mongoose 9 yet.
   - Recommendation: Start with Mongoose 8 as specified in prior decisions. The migration path to 9 is well-documented and can be done in a later phase. Monitor Mongoose 8 security patches.

2. **Cloudflare Plan Tier for Bot Protection Bypass**
   - What we know: Free plan Bot Fight Mode cannot be bypassed by WAF custom rules. Pro plan allows WAF Skip rules for specific paths.
   - What's unclear: Which Cloudflare plan the project's domain is on. Whether Bot Fight Mode is currently enabled.
   - Recommendation: Check Cloudflare dashboard for the domain. If on Free plan, either disable Bot Fight Mode entirely or upgrade to Pro for granular control. Test webhook delivery before assuming it works.

3. **TypeScript Build Configuration**
   - What we know: Prior decisions specify TypeScript strict mode. Express 5 has `@types/express` support. Backend needs a build step (`tsc` or alternative).
   - What's unclear: Whether to use `tsc` directly, `tsx` for dev, or `tsup` for building. The Dockerfile assumes a `dist/` output.
   - Recommendation: Use `tsc` for production build (outputs to `dist/`), `tsx` for development (with `--watch` for hot reload). Keep it simple -- avoid bundlers for the backend.

4. **Nginx Health Check Without curl**
   - What we know: The alpine nginx image does not include curl by default. wget is available on alpine.
   - What's unclear: Whether to install curl or use wget for healthchecks.
   - Recommendation: Use `wget --spider` in healthchecks instead of curl. It is included in alpine by default. For the backend, install wget in the Dockerfile (already needed for healthcheck).

## Sources

### Primary (HIGH confidence)
- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5.html) - All breaking changes, route syntax, removed methods
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers) - New upsertJobScheduler API
- [BullMQ Auto-Removal](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs) - removeOnComplete/removeOnFail configuration
- [BullMQ Production Guide](https://docs.bullmq.io/guide/going-to-production) - Redis noeviction, connection config, graceful shutdown
- [Mongoose Connections](https://mongoosejs.com/docs/connections.html) - Connection options, events, retry patterns
- [Mongoose 8 Migration](https://mongoosejs.com/docs/migrating_to_8.html) - Breaking changes from Mongoose 7
- [Mongoose 9 Migration](https://mongoosejs.com/docs/migrating_to_9.html) - Breaking changes from Mongoose 8
- [Docker Compose Deploy Spec](https://docs.docker.com/reference/compose-file/deploy/) - Resource limits syntax
- [Cloudflare Tunnel Config](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) - Ingress rules, service routing
- [rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis) - Redis store for express-rate-limit with ioredis
- [shadcn/ui Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) - Tailwind 4 compatibility, Vite plugin setup

### Secondary (MEDIUM confidence)
- [Express 5.1 now default on npm](https://expressjs.com/2025/03/31/v5-1-latest-release.html) - Express 5 is the default npm version
- [Cloudflare Bot Fight Mode bypass discussion](https://community.cloudflare.com/t/can-security-waf-rule-bypass-free-bot-fight-mode-for-servertoserver-communication/876164) - Free plan limitations
- [Docker Compose version field obsolete](https://forums.docker.com/t/docker-compose-yml-version-is-obsolete/141313) - Version field is ignored

### Tertiary (LOW confidence)
- Node.js crypto AES-256-GCM patterns from GitHub gists -- pattern is well-established but specific implementation details should be verified against Node.js 22 crypto docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified against npm/official docs. Express 5 confirmed as npm default. BullMQ Job Scheduler API verified against official docs.
- Architecture: HIGH - Patterns sourced from official documentation (Mongoose connections, BullMQ quick start, Docker best practices). All code examples verified.
- Pitfalls: HIGH - Redis noeviction requirement confirmed by BullMQ official docs. Cloudflare Bot Fight Mode limitation confirmed by community and Cloudflare docs. Express 5 breaking changes confirmed by official migration guide.
- Open questions: MEDIUM - Mongoose 8 vs 9 timing is a judgment call. Cloudflare plan tier depends on external configuration check.

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (30 days -- stable infrastructure domain)
