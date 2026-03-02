# Ollama Model Indicator + Usage Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the active Ollama models (embed + instruct), their health status, and accumulated usage stats (call counts, token counts) persistently in the topbar via a hoverable chip.

**Architecture:** Track usage atomically in Redis on every Ollama call; expose model info + health + counters via a new authenticated `/api/system/info` endpoint; render a `ModelIndicator` chip in the Topbar that polls the endpoint and shows a tooltip with full details.

**Tech Stack:** TypeScript, ioredis, Express, React, TanStack Query, shadcn/ui Tooltip, Lucide icons

---

## Redis Key Schema

| Key | Type | Incremented by |
|---|---|---|
| `ollama:embed:calls` | integer | `generateEmbedding` on success |
| `ollama:embed:prompt_tokens` | integer | `generateEmbedding` on success |
| `ollama:instruct:calls` | integer | `parseSearchQuery` on success |
| `ollama:instruct:prompt_tokens` | integer | `parseSearchQuery` on success |
| `ollama:instruct:completion_tokens` | integer | `parseSearchQuery` on success |

---

### Task 1: Track usage in `ollamaClient.ts`

**Files:**
- Modify: `backend/src/services/ollamaClient.ts`

**Step 1: Import Redis client**

At the top of the file, add:

```ts
import { getRedisClient } from '../config/redis.js';
```

**Step 2: Update `generateEmbedding` to track calls + tokens**

The Ollama `/api/embeddings` response includes `prompt_eval_count` alongside `embedding`. Update the response type and increment Redis counters on success.

Replace:
```ts
const data = (await response.json()) as { embedding: number[] };
return data.embedding;
```

With:
```ts
const data = (await response.json()) as { embedding: number[]; prompt_eval_count?: number };

// Track usage in Redis (fire-and-forget — don't let tracking errors break embedding)
try {
  const redis = getRedisClient();
  const tokens = data.prompt_eval_count ?? 0;
  await redis.incrby('ollama:embed:calls', 1);
  if (tokens > 0) await redis.incrby('ollama:embed:prompt_tokens', tokens);
} catch {
  // Redis unavailable -- ignore, don't break embedding
}

return data.embedding;
```

**Step 3: Update `parseSearchQuery` to track calls + tokens**

The Ollama `/api/generate` response includes `prompt_eval_count` and `eval_count`. Update the type and track:

Replace:
```ts
const data = (await response.json()) as { response: string };
const jsonStr = extractJson(data.response);
```

With:
```ts
const data = (await response.json()) as {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

// Track usage in Redis
try {
  const redis = getRedisClient();
  const promptTokens = data.prompt_eval_count ?? 0;
  const completionTokens = data.eval_count ?? 0;
  await redis.incrby('ollama:instruct:calls', 1);
  if (promptTokens > 0) await redis.incrby('ollama:instruct:prompt_tokens', promptTokens);
  if (completionTokens > 0) await redis.incrby('ollama:instruct:completion_tokens', completionTokens);
} catch {
  // Redis unavailable -- ignore
}

const jsonStr = extractJson(data.response);
```

**Step 4: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add backend/src/services/ollamaClient.ts
git commit -m "feat: track Ollama call counts and token usage in Redis"
```

---

### Task 2: Add `/api/system/info` backend endpoint

**Files:**
- Create: `backend/src/routes/system.ts`
- Modify: `backend/src/server.ts`

**Step 1: Create `system.ts` route**

```ts
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config/index.js';
import { checkOllamaHealth } from '../services/ollamaClient.js';
import { getRedisClient } from '../config/redis.js';
import logger from '../config/logger.js';

const systemRouter = Router();

systemRouter.use(requireAuth);

/**
 * GET /api/system/info
 *
 * Returns Ollama model configuration, health status, and accumulated usage stats.
 * Safe to poll frequently (30s interval) -- health check has 3s timeout.
 */
systemRouter.get('/info', async (_req: Request, res: Response) => {
  // Ollama health (runs in parallel with Redis reads)
  const [ollamaHealth, usageData] = await Promise.all([
    checkOllamaHealth().catch(() => ({ embed: false, instruct: false })),
    readUsageFromRedis(),
  ]);

  res.json({
    models: {
      embed: {
        name: config.ollamaEmbedModel,
        healthy: ollamaHealth.embed,
      },
      instruct: {
        name: config.ollamaInstructModel,
        healthy: ollamaHealth.instruct,
      },
    },
    usage: usageData,
  });
});

async function readUsageFromRedis() {
  try {
    const redis = getRedisClient();
    const [embedCalls, embedTokens, instructCalls, instructPromptTokens, instructCompletionTokens] =
      await redis.mget(
        'ollama:embed:calls',
        'ollama:embed:prompt_tokens',
        'ollama:instruct:calls',
        'ollama:instruct:prompt_tokens',
        'ollama:instruct:completion_tokens',
      );

    return {
      embed: {
        calls: parseInt(embedCalls ?? '0', 10),
        promptTokens: parseInt(embedTokens ?? '0', 10),
      },
      instruct: {
        calls: parseInt(instructCalls ?? '0', 10),
        promptTokens: parseInt(instructPromptTokens ?? '0', 10),
        completionTokens: parseInt(instructCompletionTokens ?? '0', 10),
      },
    };
  } catch (err) {
    logger.warn('Failed to read Ollama usage from Redis', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      embed: { calls: 0, promptTokens: 0 },
      instruct: { calls: 0, promptTokens: 0, completionTokens: 0 },
    };
  }
}

export { systemRouter };
```

**Step 2: Register in `server.ts`**

Add import near the other route imports:
```ts
import { systemRouter } from './routes/system.js';
```

Add mount after the existing routes:
```ts
app.use('/api/system', systemRouter);
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add backend/src/routes/system.ts backend/src/server.ts
git commit -m "feat: add /api/system/info endpoint with Ollama model info and usage stats"
```

---

### Task 3: Frontend API client for system info

**Files:**
- Create: `frontend/src/api/system.ts`

**Step 1: Create the file**

```ts
import { apiFetch } from './client';

export interface OllamaModelInfo {
  name: string;
  healthy: boolean;
}

export interface OllamaUsage {
  embed: {
    calls: number;
    promptTokens: number;
  };
  instruct: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
  };
}

export interface SystemInfoResponse {
  models: {
    embed: OllamaModelInfo;
    instruct: OllamaModelInfo;
  };
  usage: OllamaUsage;
}

/**
 * Fetch Ollama model info, health, and accumulated usage stats.
 */
export async function fetchSystemInfo(): Promise<SystemInfoResponse> {
  return apiFetch<SystemInfoResponse>('/system/info');
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/api/system.ts
git commit -m "feat: add system info API client types"
```

---

### Task 4: Create `ModelIndicator` component

**Files:**
- Create: `frontend/src/components/layout/ModelIndicator.tsx`

**Step 1: Create the component**

```tsx
import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fetchSystemInfo } from '@/api/system';
import type { SystemInfoResponse } from '@/api/system';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function HealthDot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${healthy ? 'bg-green-500' : 'bg-red-500'}`}
      aria-label={healthy ? 'healthy' : 'offline'}
    />
  );
}

function ModelRow({
  label,
  name,
  healthy,
  stats,
}: {
  label: string;
  name: string;
  healthy: boolean;
  stats: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <HealthDot healthy={healthy} />
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">{name}</span>
      </div>
      <p className="text-xs text-muted-foreground pl-3.5">{stats}</p>
    </div>
  );
}

function TooltipBody({ data }: { data: SystemInfoResponse }) {
  const { models, usage } = data;

  const embedStats = `${formatCount(usage.embed.calls)} calls · ${formatCount(usage.embed.promptTokens)} tokens`;
  const instructStats = `${formatCount(usage.instruct.calls)} calls · ${formatCount(usage.instruct.promptTokens + usage.instruct.completionTokens)} tokens (${formatCount(usage.instruct.promptTokens)} in / ${formatCount(usage.instruct.completionTokens)} out)`;

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs font-semibold text-foreground">Ollama Models</p>
      <ModelRow
        label="Embed"
        name={models.embed.name}
        healthy={models.embed.healthy}
        stats={embedStats}
      />
      <ModelRow
        label="Instruct"
        name={models.instruct.name}
        healthy={models.instruct.healthy}
        stats={instructStats}
      />
    </div>
  );
}

/**
 * Topbar chip showing active Ollama model health + usage.
 * Polls every 30 seconds. Shows health dot + instruct model name.
 * Click/hover opens a tooltip with full details.
 */
export function ModelIndicator() {
  const { data, isError } = useQuery({
    queryKey: ['system-info'],
    queryFn: fetchSystemInfo,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  // Determine chip health status
  const bothHealthy = data?.models.embed.healthy && data?.models.instruct.healthy;
  const oneDown = data && (!data.models.embed.healthy || !data.models.instruct.healthy);
  const dotColor = isError || !data
    ? 'bg-muted-foreground'
    : bothHealthy
    ? 'bg-green-500'
    : oneDown
    ? 'bg-amber-500'
    : 'bg-red-500';

  const chip = (
    <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-default select-none">
      <Cpu className="h-3 w-3" />
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span className="font-mono">{data?.models.instruct.name ?? '…'}</span>
    </div>
  );

  if (!data) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="bottom" className="w-72">
        <TooltipBody data={data} />
      </TooltipContent>
    </Tooltip>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/components/layout/ModelIndicator.tsx
git commit -m "feat: add ModelIndicator topbar chip for Ollama model health and usage"
```

---

### Task 5: Add `ModelIndicator` to Topbar

**Files:**
- Modify: `frontend/src/components/layout/Topbar.tsx`

**Step 1: Import `ModelIndicator`**

Add to the imports at the top:
```ts
import { ModelIndicator } from '@/components/layout/ModelIndicator';
```

**Step 2: Insert chip in the right section**

In the `<div className="flex flex-1 items-center justify-end gap-3">` block, add `<ModelIndicator />` before `<KillSwitch />`:

```tsx
<div className="flex flex-1 items-center justify-end gap-3">
  <ModelIndicator />
  <KillSwitch />
  <NotificationBell />
  ...
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 4: Rebuild and verify in browser**

```bash
cd /home/admin/claude/MSEDB && docker compose up -d --build
```

Open any page. Verify:
- Small chip is visible in topbar (left of KillSwitch): `[■ qwen3:1.7b]`
- Green dot = both models up, amber = one down, gray = no data yet
- Hovering over chip shows tooltip with embed + instruct model info, health, and usage counts
- After performing an AI search, counts increment on next refresh (30s or page reload)

**Step 5: Commit**

```bash
git add frontend/src/components/layout/Topbar.tsx
git commit -m "feat: add ModelIndicator to topbar for always-visible Ollama model status"
```
