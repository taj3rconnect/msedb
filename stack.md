# stack.md — MSEDB definitive tech stack

The authoritative FE + BE stack for this repo. **Written from lockfiles**
(`backend/package-lock.json`, `frontend/package-lock.json`) and `.nvmrc`, not from
intent. No AI session should guess the stack — read this file.

- Generated: 2026-08-08 (`/tappaudit --fix`)
- Source of truth for versions: the lockfiles. Re-generate this table when they change.

## Runtime & tooling

| Thing | Version in use | Where pinned |
|---|---|---|
| Node.js | **24** | `.nvmrc` (CI reads it via `node-version-file`) |
| TypeScript | **5.9.3** (both packages) | lockfiles |
| Package manager | **npm** (`package-lock.json`) | ⚠ `frontend/yarn.lock` also present — see Known drift |
| Container base | Docker (`backend/Dockerfile`, `frontend/Dockerfile`) | `docker-compose.yml` |

## Backend — `backend/` (`msedb-backend`, ESM)

| Area | Package | Version |
|---|---|---|
| HTTP server | express | 5.2.1 |
| Realtime | socket.io | 4.8.3 |
| Database (ODM) | mongoose | 8.23.0 |
| Cache / queues | ioredis | 5.9.3 |
| Job queue | bullmq | 5.69.3 |
| Auth (MS identity) | @azure/msal-node | 3.8.7 |
| JWT | jsonwebtoken | 9.0.3 |
| JWKS (add-in bearer) | jwks-rsa | 3.2.2 |
| Vector DB client | @qdrant/js-client-rest | 1.17.0 |
| Logging | winston | 3.19.0 |
| Security middleware | helmet | 8.1.0 |
| Rate limiting | express-rate-limit 7.5.1 + rate-limit-redis 4.3.1 |
| Misc | compression 1.8.1 · cookie-parser 1.4.7 · cors 2.8.6 · dotenv 16.6.1 · geoip-lite 1.4.10 · ua-parser-js 2.0.9 · uuid 13.0.0 |
| Test | vitest 4.0.18 (+ @vitest/coverage-v8) |
| Dev runner | tsx 4.19.x (`yarn dev` / `npm run dev`) |

**Datastores:** MongoDB `mongo:8.2` (container `msedb-mongo`, db `msedb`) ·
Redis `redis:8-alpine` (container `msedb-redis`) · Qdrant — **external**, AX1's
instance on `ax1_default` network (port 6333).

**LLM:** Ollama on the DGX (`http://100.119.177.14:11434`) — embeddings
`nomic-embed-text`, instruct `qwen3:1.7b`, write `qwen3.5:35b-a3b`.

## Frontend — `frontend/` (`msedb-frontend`, ESM)

| Area | Package | Version |
|---|---|---|
| Framework | react / react-dom | 19.2.4 |
| Router | react-router | 7.13.0 |
| Build tool | vite | 6.4.1 |
| Styling | tailwindcss 4.x + @tailwindcss/vite 4.x + tw-animate-css |
| Components | radix-ui 1.4.3 + shadcn 3.8.5 (generator) |
| Icons | lucide-react | 0.574.0 |
| Server state | @tanstack/react-query | 5.90.21 |
| Client state | zustand | 5.0.11 |
| Data grids | ag-grid-community / ag-grid-react 35.1.0 · @tanstack/react-table 8.21.3 |
| Charts | recharts | 2.15.4 |
| Realtime | socket.io-client | 4.8.3 |
| Notifications | sonner | 2.0.7 |
| Drag & drop | @dnd-kit/core 6.3.1 · sortable 10.0.0 · utilities 3.2.2 |
| Other | date-fns 4.1.0 · minisearch 7.2.0 · next-themes 0.4.6 · react-resizable-panels 4.6.4 · clsx · class-variance-authority · tailwind-merge |

Served in production by **Nginx** (self-signed certs from `certs/`).
Path alias: `@/*` → `frontend/src/*`.

## Office Add-in — `addin/` (`msedb-addin`)

React 19 + @azure/msal-browser 3.28 + Tailwind 4, bundled with **webpack 5**
(`ts-loader`, `html-webpack-plugin`, `copy-webpack-plugin`). Built separately
(`cd addin && npm run build`); output is bind-mounted into the frontend Nginx
container at `/addin`.

## Desktop app — `desktop/` (`msedb-desktop`, CommonJS)

**electron 34.x** + **electron-builder 25.x** + TypeScript 5.7.x. No runtime
dependencies. Runs natively on the host — not in Docker, not in the compose stack.

## Known drift / cleanups

| Item | Detail |
|---|---|
| Mixed package managers | `frontend/` carries **both** `yarn.lock` and `package-lock.json`; project CLAUDE.md documents `yarn` commands while CI runs `npm ci`. Pick one and delete the other lockfile. |
| No linter configured | No `eslint.config.*` / `.eslintrc*` / `biome.json` anywhere, yet `frontend/package.json` declares `"lint": "eslint ."` and eslint is not even a dependency — that script cannot run. |
| Registry drift | Vault `PORT_REGISTRY.json` records MongoDB as `mongo:7`; `docker-compose.yml` runs `mongo:8.2`. |
| No SQL / no Prisma | Datastore is MongoDB via Mongoose. The global Prisma rule targets SQL databases and does not apply here; there is consequently **no migration framework** — see `data.md`. |
