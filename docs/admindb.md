# AdminDB — Docker Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Docker management dashboard to MSEDB that lets admin users monitor and start/stop all Docker containers on the DGX server, accessible via `admindb.aptask.com`.

**Architecture:** New `/admin/docker` route in MSEDB frontend, new `/api/admin/docker/*` Express endpoints in backend using `dockerode` via the already-mounted Docker socket. Protected by existing `requireAdmin` middleware. Cloudflare tunnel routes `admindb.aptask.com` to the existing MSEDB frontend.

**Tech Stack:** dockerode (Node.js Docker API), React + TanStack Query, shadcn/ui cards, existing MSEDB auth

---

## Key Files to Know

- `frontend/src/App.tsx` — router, add `/admin/docker` route + `DockerGuard`
- `frontend/src/lib/constants.ts` — `NAV_ITEMS` array, add Docker menu item (`adminOnly: true`)
- `frontend/src/components/layout/AppSidebar.tsx` — already filters nav by `adminOnly`, no changes needed
- `frontend/src/pages/AdminPage.tsx` — existing admin page for reference/style
- `frontend/src/api/client.ts` — `apiFetch` helper used for all API calls
- `backend/src/routes/admin.ts` — existing admin router with `requireAuth + requireAdmin` already applied
- `backend/src/index.ts` — where routes are registered
- `.cloudflared/config.yml` — Cloudflare tunnel ingress rules
- `docker-compose.yml` — Docker socket already mounted: `/var/run/docker.sock:/var/run/docker.sock:ro`

---

## Task 1: Install dockerode in backend

**Files:**
- Modify: `backend/package.json`

**Step 1: Install packages**

```bash
cd /home/admin/claude/MSEDB/backend
npm install dockerode
npm install --save-dev @types/dockerode
```

**Step 2: Verify**

```bash
node -e "const Docker = require('dockerode'); console.log('ok')"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add dockerode dependency for Docker API access"
```

---

## Task 2: Create Docker service

**Files:**
- Create: `backend/src/services/dockerService.ts`

**Step 1: Create the service**

```typescript
import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;       // 'running' | 'exited' | 'paused' etc
  health: string;       // 'healthy' | 'unhealthy' | 'starting' | 'none'
  uptime: string;
  ports: string[];
  stack: string;        // compose project name or 'standalone'
}

export interface StackInfo {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
}

function formatUptime(startedAt: string): string {
  if (!startedAt || startedAt === '0001-01-01T00:00:00Z') return '';
  const diff = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatPorts(ports: Docker.Port[]): string[] {
  return (ports || [])
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`)
    .filter((v, i, arr) => arr.indexOf(v) === i); // dedupe
}

export async function listStacks(): Promise<StackInfo[]> {
  const containers = await docker.listContainers({ all: true });

  const stackMap = new Map<string, ContainerInfo[]>();

  for (const c of containers) {
    const name = (c.Names[0] || '').replace(/^\//, '');
    const stack = c.Labels?.['com.docker.compose.project'] || 'standalone';
    const health = c.Status.includes('healthy')
      ? 'healthy'
      : c.Status.includes('unhealthy')
        ? 'unhealthy'
        : c.Status.includes('starting')
          ? 'starting'
          : 'none';

    const info: ContainerInfo = {
      id: c.Id,
      name,
      image: c.Image,
      status: c.State,        // 'running', 'exited', etc
      health,
      uptime: c.State === 'running' ? formatUptime(c.Status) : '',
      ports: formatPorts(c.Ports),
      stack,
    };

    if (!stackMap.has(stack)) stackMap.set(stack, []);
    stackMap.get(stack)!.push(info);
  }

  return Array.from(stackMap.entries())
    .map(([name, containers]) => ({
      name,
      containers,
      runningCount: containers.filter((c) => c.status === 'running').length,
      totalCount: containers.length,
    }))
    .sort((a, b) => {
      // msedb first, then alphabetical
      if (a.name === 'msedb') return -1;
      if (b.name === 'msedb') return 1;
      return a.name.localeCompare(b.name);
    });
}

export async function startContainer(id: string): Promise<void> {
  const container = docker.getContainer(id);
  await container.start();
}

export async function stopContainer(id: string): Promise<void> {
  const container = docker.getContainer(id);
  await container.stop({ t: 10 }); // 10s grace period
}
```

**Step 2: Commit**

```bash
git add backend/src/services/dockerService.ts
git commit -m "feat: add dockerService to list and control containers"
```

---

## Task 3: Add Docker routes to admin router

**Files:**
- Modify: `backend/src/routes/admin.ts`

**Step 1: Add imports at top of file**

Add after existing imports:

```typescript
import {
  listStacks,
  startContainer,
  stopContainer,
} from '../services/dockerService.js';
```

**Step 2: Add routes at the bottom of admin.ts (before `export default adminRouter`)**

```typescript
// ─── Docker Management ────────────────────────────────────────────────────

/**
 * GET /api/admin/docker/stacks
 * Returns all Docker stacks with their containers, status, ports, uptime.
 */
adminRouter.get('/docker/stacks', async (_req: Request, res: Response) => {
  const stacks = await listStacks();
  res.json({ stacks });
});

/**
 * POST /api/admin/docker/containers/:id/start
 * Starts a single container by ID.
 */
adminRouter.post('/docker/containers/:id/start', async (req: Request, res: Response) => {
  await startContainer(req.params.id);
  res.json({ ok: true });
});

/**
 * POST /api/admin/docker/containers/:id/stop
 * Stops a single container by ID (10s grace period).
 */
adminRouter.post('/docker/containers/:id/stop', async (req: Request, res: Response) => {
  await stopContainer(req.params.id);
  res.json({ ok: true });
});

/**
 * POST /api/admin/docker/stacks/:stack/start
 * Starts all stopped containers in a named stack.
 */
adminRouter.post('/docker/stacks/:stack/start', async (req: Request, res: Response) => {
  const stacks = await listStacks();
  const stack = stacks.find((s) => s.name === req.params.stack);
  if (!stack) throw new NotFoundError(`Stack "${req.params.stack}" not found`);

  const stopped = stack.containers.filter((c) => c.status !== 'running');
  await Promise.all(stopped.map((c) => startContainer(c.id)));
  res.json({ ok: true, started: stopped.length });
});

/**
 * POST /api/admin/docker/stacks/:stack/stop
 * Stops all running containers in a named stack (skips msedb stack to prevent self-stop).
 */
adminRouter.post('/docker/stacks/:stack/stop', async (req: Request, res: Response) => {
  if (req.params.stack === 'msedb') {
    throw new ValidationError('Cannot stop the msedb stack via this interface');
  }
  const stacks = await listStacks();
  const stack = stacks.find((s) => s.name === req.params.stack);
  if (!stack) throw new NotFoundError(`Stack "${req.params.stack}" not found`);

  const running = stack.containers.filter((c) => c.status === 'running');
  await Promise.all(running.map((c) => stopContainer(c.id)));
  res.json({ ok: true, stopped: running.length });
});
```

**Step 3: Rebuild and test**

```bash
cd /home/admin/claude/MSEDB
docker compose up -d --build msedb-backend
curl -s http://localhost:8010/api/health | grep ok
```

**Step 4: Test routes with a valid admin session cookie (get it from browser DevTools)**

```bash
curl -s -H "Cookie: msedb_session=<token>" http://localhost:8010/api/admin/docker/stacks | head -c 200
```

Expected: JSON with `{ stacks: [...] }`

**Step 5: Commit**

```bash
git add backend/src/routes/admin.ts
git commit -m "feat: add Docker management API routes to admin router"
```

---

## Task 4: Add frontend API client

**Files:**
- Create: `frontend/src/api/docker.ts`

**Step 1: Create the API module**

```typescript
import { apiFetch } from './client';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  health: string;
  uptime: string;
  ports: string[];
  stack: string;
}

export interface StackInfo {
  name: string;
  containers: ContainerInfo[];
  runningCount: number;
  totalCount: number;
}

export async function fetchDockerStacks(): Promise<{ stacks: StackInfo[] }> {
  return apiFetch<{ stacks: StackInfo[] }>('/admin/docker/stacks');
}

export async function startContainer(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/docker/containers/${id}/start`, { method: 'POST' });
}

export async function stopContainer(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/docker/containers/${id}/stop`, { method: 'POST' });
}

export async function startStack(stack: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/docker/stacks/${stack}/start`, { method: 'POST' });
}

export async function stopStack(stack: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/admin/docker/stacks/${stack}/stop`, { method: 'POST' });
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/docker.ts
git commit -m "feat: add Docker API client module"
```

---

## Task 5: Create AdminDockerPage

**Files:**
- Create: `frontend/src/pages/AdminDockerPage.tsx`

**Step 1: Create the page**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Play, Square, Loader2, Container } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  fetchDockerStacks,
  startContainer,
  stopContainer,
  startStack,
  stopStack,
  type StackInfo,
  type ContainerInfo,
} from '@/api/docker';

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, health }: { status: string; health: string }) {
  if (status !== 'running') {
    return <Badge variant="destructive">stopped</Badge>;
  }
  if (health === 'unhealthy') {
    return <Badge variant="destructive">unhealthy</Badge>;
  }
  if (health === 'starting') {
    return <Badge variant="secondary">starting</Badge>;
  }
  return <Badge className="bg-green-600 text-white hover:bg-green-700">running</Badge>;
}

// ─── Container Row ───────────────────────────────────────────────────────────

function ContainerRow({ container, stackName }: { container: ContainerInfo; stackName: string }) {
  const queryClient = useQueryClient();

  const { mutate: doStart, isPending: starting } = useMutation({
    mutationFn: () => startContainer(container.id),
    onSuccess: () => {
      toast.success(`Started ${container.name}`);
      queryClient.invalidateQueries({ queryKey: ['docker-stacks'] });
    },
    onError: () => toast.error(`Failed to start ${container.name}`),
  });

  const { mutate: doStop, isPending: stopping } = useMutation({
    mutationFn: () => stopContainer(container.id),
    onSuccess: () => {
      toast.success(`Stopped ${container.name}`);
      queryClient.invalidateQueries({ queryKey: ['docker-stacks'] });
    },
    onError: () => toast.error(`Failed to stop ${container.name}`),
  });

  const isRunning = container.status === 'running';
  const isMsedb = stackName === 'msedb';

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 text-sm">
      <StatusBadge status={container.status} health={container.health} />
      <span className="font-mono font-medium flex-1 truncate">{container.name}</span>
      <span className="text-muted-foreground truncate max-w-[200px]">{container.image}</span>
      {container.ports.length > 0 && (
        <span className="text-xs text-muted-foreground font-mono">
          {container.ports.join(', ')}
        </span>
      )}
      {container.uptime && (
        <span className="text-xs text-muted-foreground w-16 text-right">{container.uptime}</span>
      )}
      <div className="flex gap-1 shrink-0">
        {!isRunning && (
          <Button size="sm" variant="outline" onClick={() => doStart()} disabled={starting}>
            {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          </Button>
        )}
        {isRunning && !isMsedb && (
          <Button size="sm" variant="outline" onClick={() => doStop()} disabled={stopping}>
            {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Stack Card ───────────────────────────────────────────────────────────────

function StackCard({ stack }: { stack: StackInfo }) {
  const [expanded, setExpanded] = useState(true);
  const queryClient = useQueryClient();
  const isMsedb = stack.name === 'msedb';
  const allRunning = stack.runningCount === stack.totalCount;
  const noneRunning = stack.runningCount === 0;

  const { mutate: doStartAll, isPending: startingAll } = useMutation({
    mutationFn: () => startStack(stack.name),
    onSuccess: () => {
      toast.success(`Starting all containers in ${stack.name}`);
      queryClient.invalidateQueries({ queryKey: ['docker-stacks'] });
    },
    onError: () => toast.error(`Failed to start ${stack.name}`),
  });

  const { mutate: doStopAll, isPending: stoppingAll } = useMutation({
    mutationFn: () => stopStack(stack.name),
    onSuccess: () => {
      toast.success(`Stopping all containers in ${stack.name}`);
      queryClient.invalidateQueries({ queryKey: ['docker-stacks'] });
    },
    onError: () => toast.error(`Failed to stop ${stack.name}`),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 flex-1 text-left"
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <CardTitle className="text-base font-mono">{stack.name}</CardTitle>
            <span className="text-sm text-muted-foreground">
              {stack.runningCount}/{stack.totalCount} running
            </span>
          </button>
          <div className="flex gap-2">
            {!allRunning && (
              <Button size="sm" variant="outline" onClick={() => doStartAll()} disabled={startingAll}>
                {startingAll ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Start All
              </Button>
            )}
            {!noneRunning && !isMsedb && (
              <Button size="sm" variant="outline" onClick={() => doStopAll()} disabled={stoppingAll}>
                {stoppingAll ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Square className="h-3 w-3 mr-1" />}
                Stop All
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="divide-y divide-border/50">
            {stack.containers.map((c) => (
              <ContainerRow key={c.id} container={c} stackName={stack.name} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminDockerPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['docker-stacks'],
    queryFn: fetchDockerStacks,
    refetchInterval: 10_000, // auto-refresh every 10s
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        Failed to load Docker info
      </div>
    );
  }

  const stacks = data?.stacks ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <Container className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Docker</h1>
        <span className="text-sm text-muted-foreground ml-auto">
          Auto-refreshes every 10s
        </span>
      </div>
      {stacks.map((stack) => (
        <StackCard key={stack.name} stack={stack} />
      ))}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/AdminDockerPage.tsx
git commit -m "feat: add AdminDockerPage with stack cards and start/stop controls"
```

---

## Task 6: Wire up route and nav item

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/lib/constants.ts`

**Step 1: Add import and route to App.tsx**

Add import near other page imports:

```typescript
import { AdminDockerPage } from '@/pages/AdminDockerPage';
```

Add `DockerGuard` component after existing `AdminGuard`:

```typescript
function DockerGuard() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <AdminDockerPage />;
}
```

Add route inside the `ProtectedLayout` children array (after `/admin`):

```typescript
{
  path: '/admin/docker',
  element: <DockerGuard />,
},
```

**Step 2: Add nav item to constants.ts**

In `NAV_ITEMS`, add after the existing `Admin Panel` entry:

```typescript
{ label: 'Docker', path: ROUTE_PATHS.adminDocker, icon: Container, adminOnly: true },
```

Add to `ROUTE_PATHS`:

```typescript
adminDocker: '/admin/docker',
```

Add `Container` to the lucide-react import at top of constants.ts.

**Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/lib/constants.ts
git commit -m "feat: add Docker menu item and /admin/docker route (admin only)"
```

---

## Task 7: Add admindb.aptask.com to Cloudflare tunnel

**Files:**
- Modify: `.cloudflared/config.yml`

**Step 1: Add ingress rule**

Add before the catch-all `http_status:404` line:

```yaml
  - hostname: admindb.aptask.com
    service: http://msedb-frontend:8081
```

**Step 2: Restart tunnel**

```bash
cd /home/admin/claude/MSEDB
docker compose restart msedb-tunnel
```

**Step 3: Verify in Cloudflare dashboard**

Go to Cloudflare Zero Trust → Tunnels → `acdd721a...` → check `admindb.aptask.com` is listed.

Also add DNS record in Cloudflare for `admindb.aptask.com` → CNAME to the tunnel (same as `msedb.aptask.com`).

**Step 4: Commit**

```bash
git add .cloudflared/config.yml
git commit -m "feat: add admindb.aptask.com ingress to Cloudflare tunnel"
```

---

## Task 8: Build and deploy

**Step 1: Full rebuild**

```bash
cd /home/admin/claude/MSEDB
docker compose up -d --build
```

**Step 2: Smoke test**

1. Open `https://msedb.aptask.com` → log in as admin
2. Verify "Docker" menu item appears in sidebar
3. Verify `/admin/docker` loads stack cards
4. Verify non-admin user does NOT see the Docker menu item
5. Open `https://admindb.aptask.com` → should load MSEDB login → after login, navigate to `/admin/docker`

**Step 3: Final commit with version bump**

```bash
git add .
git commit -m "feat: AdminDB Docker dashboard — monitor and control all DGX containers from MSEDB"
```

---

## Notes

- **msedb stack protection**: The Stop All button is hidden for the `msedb` stack, and the backend rejects stop requests for it — prevents self-shutdown
- **Docker socket**: Already mounted read-write in `docker-compose.yml` (`:ro` flag only blocks filesystem writes, not Docker API calls — start/stop will work)
- **Port**: Cloudflare points to `msedb-frontend:8081` (internal nginx port), matching existing `msedb.aptask.com` config
