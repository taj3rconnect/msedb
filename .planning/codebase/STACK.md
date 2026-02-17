# Technology Stack

**Analysis Date:** 2026-02-16

## Languages

**Primary:**
- TypeScript - Used across both frontend and backend with strict mode enabled
- JavaScript - Runtime and build scripts
- HTML/CSS - Frontend markup and styling

**Secondary:**
- YAML - Docker Compose and configuration files
- Bash - Deployment and backup scripts

## Runtime

**Environment:**
- Node.js 20 (LTS) - Both frontend build and backend runtime
- Docker 27+ with Docker Compose 3.8
- Alpine Linux (minimal base images)

**Package Manager:**
- npm - Primary package manager
- Lockfiles: package-lock.json (required for reproducible builds)

## Frameworks

**Frontend:**
- React 18 - UI framework
- Vite - Build tool and development server
- Tailwind CSS - Utility-first CSS framework
- shadcn/ui - Component library built on Radix UI

**Backend:**
- Express.js - REST API framework
- Socket.IO - Real-time bidirectional communication
- BullMQ - Job queue and background processing backed by Redis

**State Management:**
- Zustand - Frontend state management
- TanStack Query (React Query) - Server state and data fetching

## Key Dependencies

**Critical:**
- `@azure/msal-node` [3.x] - OAuth 2.0 MSAL library for Azure AD authentication
  - Handles OAuth code flow and token lifecycle management
- `@microsoft/microsoft-graph-client` [3.x] - Official SDK for Microsoft Graph API
  - Used for Mail.ReadWrite, Mail.Send, MailboxSettings operations
- `mongoose` [7.x+] - MongoDB ODM with schema validation and indexing
- `redis` [4.x] - Redis client for cache and queue operations
- `bull` [4.x] - BullMQ queue library for job processing
- `axios` [1.x] - HTTP client with JWT interceptor support

**Authentication & Security:**
- `jsonwebtoken` [9.x] - JWT signing and verification
- `bcryptjs` [2.x] - Password hashing (if implemented)
- `crypto` (Node.js built-in) - AES-256-GCM encryption for stored tokens
- `dotenv` [16.x] - Environment variable loading

**Logging & Observability:**
- `winston` [3.x] - Structured logging framework
  - Supports multiple transports (console, file, MongoDB optional)

**Frontend HTTP:**
- Axios - Client-side HTTP requests with interceptors for JWT token attachment

**Real-time Communication:**
- Socket.IO [4.x] - WebSocket abstraction for real-time updates
  - Pattern notifications, rule execution feedback, dashboard updates

**Utilities:**
- `date-fns` or `dayjs` - Date/time manipulation (for timestamp normalization)
- `lodash` or `lodash-es` - Utility functions

## Configuration

**Environment:**
- `.env` file contains all configuration (never committed to git)
- `NODE_ENV` set to 'development' or 'production'
- Environment variables required:
  - Azure AD: `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`
  - URLs: `APP_URL`, `API_URL`, `GRAPH_WEBHOOK_URL`
  - Databases: `MONGODB_URI`, `REDIS_URL`
  - Secrets: `SESSION_SECRET`, `JWT_SECRET`, `ENCRYPTION_KEY` (generated with openssl)
  - Admin: `ADMIN_EMAIL`
  - App tuning: `LOG_LEVEL`, `EVENT_RETENTION_DAYS`, `STAGING_GRACE_PERIOD_HOURS`

**Build Configuration:**
- `frontend/vite.config.js` - Vite build configuration, API proxying setup
- `frontend/tailwind.config.js` - Tailwind CSS customization
- `frontend/postcss.config.js` - PostCSS for Tailwind
- `backend/package.json` - Express server entry point: `src/server.js`

**TypeScript:**
- `tsconfig.json` (if used) - Strict mode enabled in both frontend and backend
- Type definitions for all major dependencies

## Database Configuration

**MongoDB:**
- Image: `mongo:7`
- Connection string: `mongodb://msedb-mongo:27017/msedb` (internal Docker network)
- Mongoose models with automatic timestamps
- Indexes required on: User.email, User.microsoftId, EmailEvent.userId, Pattern.userId, Rule.userId

**Redis:**
- Image: `redis:7-alpine`
- Connection string: `redis://msedb-redis:6379` (internal Docker network)
- Used for: Session storage, BullMQ job persistence, cache
- Persistence: Enabled via `--appendonly yes` and RDB snapshots

## Containerization

**Base Images:**
- `node:20-alpine` - For both frontend builder and backend runtime (minimal footprint)
- `nginx:alpine` - Frontend production server
- `mongo:7` - MongoDB official image
- `redis:7-alpine` - Redis official image

**Build Strategy:**
- Multi-stage Dockerfile for backend: builder stage → slim runtime stage
- Multi-stage Dockerfile for frontend: Node.js build → nginx runtime
- Non-root user execution in all containers
- Health checks on all services

**Network:**
- Docker bridge network: `msedb-network`
- Containers communicate via service names (e.g., `msedb-mongo:27017`)
- Only frontend (3010) and backend (8010) ports exposed to host

**Resource Limits (Docker Compose deploy):**
- `msedb-frontend`: 0.5 CPU, 512MB RAM
- `msedb-backend`: 2.0 CPU, 2GB RAM
- `msedb-mongo`: 2.0 CPU, 2GB RAM
- `msedb-redis`: 0.5 CPU, 512MB RAM
- **Total cap: 5 CPU cores, 5GB RAM**

**Volumes:**
- `msedb-mongo-data` - MongoDB persistent storage at `/data/db`
- `msedb-redis-data` - Redis persistence at `/data`
- `msedb-logs` - Application logs at `/app/logs`

## Development Tools

**Testing Framework:** (if specified in package.json)
- Jest or Vitest
- Testing Library for React components

**Linting & Formatting:**
- ESLint configuration (if present)
- Prettier for code formatting

**Development Overrides:**
- `docker-compose.dev.yml` - Overrides for hot reload and volume mounts during development

## Platform Requirements

**Development:**
- Docker Desktop or Docker Engine + Docker Compose v2+
- Node.js 20 (optional, for local testing)
- npm or yarn
- Bash shell for scripts

**Production (DGX Server):**
- Linux host (tested on DGX with Linux 6.14.0-1015-nvidia)
- Docker 27+ and Docker Compose 3.8+
- Cloudflare Tunnel for public HTTPS webhook endpoint
- Minimum 5 CPU cores and 5GB RAM available
- Outbound HTTPS (443) to Azure AD and Microsoft Graph API
- Outbound access to Cloudflare (port 7844) for tunnel

**Deployment Target:**
- DGX Server: `http://172.16.219.222/` (internal LAN)
- Ports must be free: 3010, 8010, 27020, 6382
- No existing Docker networks can conflict with `msedb-network`

---

*Stack analysis: 2026-02-16*
