# Phase 4: Frontend Shell & Observation UI - Research

**Researched:** 2026-02-17
**Domain:** React SPA setup (shadcn/ui, routing, state management, real-time updates via Socket.IO)
**Confidence:** HIGH

## Summary

Phase 4 transforms the frontend from a placeholder "Hello World" page into a fully functional React SPA with authentication, layout shell, dashboard, email activity page, and real-time updates via Socket.IO. The existing codebase provides a React 19 + Vite + Tailwind 4 skeleton with nginx proxy configuration, and the backend has auth routes (login, callback, logout, /auth/me), mailbox routes, webhook handlers, and email event collection -- but no Socket.IO server, no dashboard API endpoints, and no frontend routing, state management, or UI components.

The work divides into three logical chunks: (1) setting up shadcn/ui, routing, auth context, and protected routes; (2) building the app shell layout (sidebar, topbar with kill switch), dashboard page with stats and activity feed, and Socket.IO integration on both client and server; (3) building the email activity page with filterable data table, event timeline, and sender breakdown.

**Primary recommendation:** Use `npx shadcn@latest init` for component setup with Tailwind v4, React Router v7 (the `react-router` package, not `react-router-dom`), TanStack Query v5 for server state, Zustand v5 for client state, Socket.IO v4 for real-time updates, and Recharts via shadcn/ui's built-in chart component for any visualizations. Authenticate Socket.IO connections using the existing httpOnly JWT cookie via `cookie-parser` on the Socket.IO engine middleware.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Dashboard home with stats cards (emails processed, rules fired, patterns pending, staging count), activity feed, and pending suggestions. Per-mailbox and aggregate views | shadcn/ui Card component for stats, TanStack Query for data fetching from new GET /api/dashboard/stats and GET /api/dashboard/activity endpoints, Zustand for mailbox selection state, Socket.IO for live counter updates |
| DASH-02 | Real-time updates via Socket.IO -- email events, pattern detections, rule executions, staging changes appear live | Socket.IO v4 server attached to existing Express HTTP server, JWT cookie auth middleware on handshake, user-scoped rooms (user:{userId}), backend emits events after EmailEvent creation, frontend useSocket hook consumes events and invalidates TanStack Query cache |
| PAGE-01 | Email activity page with per-mailbox filters, event timeline, and sender breakdown | shadcn/ui DataTable (TanStack Table v8) for filterable event list with pagination, GET /api/events endpoint with query params (mailboxId, eventType, sender, page, limit), Recharts (via shadcn Chart component) for timeline and sender breakdown charts |
</phase_requirements>

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.0.0 | UI framework | Already installed |
| react-dom | ^19.0.0 | DOM rendering | Already installed |
| tailwindcss | ^4.0.0 | Utility CSS | Already installed |
| @tailwindcss/vite | ^4.0.0 | Vite plugin for Tailwind | Already installed |
| vite | ^6.0.0 | Build tool | Already installed |
| typescript | ^5.7.0 | Type safety | Already installed |

### New Frontend Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-router | ^7.13.0 | Client-side routing | All page navigation, protected routes. Note: v7 consolidated react-router-dom into react-router |
| @tanstack/react-query | ^5.90.0 | Server state management | All API data fetching (dashboard stats, events, user info) |
| zustand | ^5.0.0 | Client state management | Auth state, mailbox selection, UI state (sidebar collapsed, etc.) |
| socket.io-client | ^4.8.0 | WebSocket client | Real-time event subscription from backend |
| @tanstack/react-table | ^8.21.0 | Headless table logic | Email activity data table with sorting, filtering, pagination |
| recharts | ^3.7.0 | Chart library | Event timeline and sender breakdown charts (used via shadcn Chart component) |
| react-is | ^19.0.0 | React type checking | Required override for recharts React 19 compatibility |
| lucide-react | latest | Icon library | shadcn/ui default icon library, tree-shakable |
| date-fns | ^4.0.0 | Date formatting | Relative timestamps ("2 minutes ago"), date ranges |

### New Backend Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| socket.io | ^4.8.0 | WebSocket server | Real-time event broadcasting to connected dashboard clients |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React Router v7 | TanStack Router | TanStack Router is more type-safe but has steeper learning curve and less ecosystem support. React Router is the established standard and more appropriate for this project's complexity. |
| Zustand | React Context | Context causes re-renders on all consumers. Zustand is selective and performant. For auth + UI state across many components, Zustand is standard. |
| TanStack Query | SWR | TanStack Query has better devtools, more features (mutations, optimistic updates, cache invalidation). Standard in the ecosystem. |
| Recharts | Nivo / Victory | Recharts is shadcn/ui's built-in chart library. Using it avoids additional bundle and gets the shadcn theming for free. |

### Installation

Frontend:
```bash
cd frontend
npm install react-router @tanstack/react-query @tanstack/react-table zustand socket.io-client recharts react-is@19.0.0 lucide-react date-fns
```

Frontend package.json overrides (for recharts React 19 compatibility):
```json
{
  "overrides": {
    "react-is": "$react-is"
  }
}
```

Backend:
```bash
cd backend
npm install socket.io
npm install -D @types/cookie-parser
```

shadcn/ui initialization (after dependencies):
```bash
cd frontend
npx shadcn@latest init
```

## Architecture Patterns

### Recommended Frontend Structure

```
frontend/src/
  components/
    ui/              # shadcn/ui components (auto-generated, do not edit)
    layout/
      AppShell.tsx    # Main layout: sidebar + topbar + content
      Sidebar.tsx     # Navigation sidebar with links to all pages
      Topbar.tsx      # Top bar with kill switch toggle, user menu
      KillSwitch.tsx  # Prominent automation pause toggle
    dashboard/
      StatsCards.tsx   # Grid of stat cards (emails processed, etc.)
      ActivityFeed.tsx # Recent email events feed
    events/
      EventsTable.tsx      # TanStack Table for email events
      EventTimeline.tsx    # Recharts timeline chart
      SenderBreakdown.tsx  # Recharts pie/bar chart of sender distribution
    shared/
      EmptyState.tsx       # Reusable empty state placeholder
      LoadingSpinner.tsx   # Loading indicator
      MailboxSelector.tsx  # Dropdown to switch mailbox context
  pages/
    LoginPage.tsx          # Login page with "Sign in with Microsoft" button
    DashboardPage.tsx      # Dashboard home (DASH-01)
    EmailActivityPage.tsx  # Email activity (PAGE-01)
    NotFoundPage.tsx       # 404 page
  hooks/
    useAuth.ts             # Auth state + login/logout actions
    useSocket.ts           # Socket.IO connection + event subscription
    useDashboard.ts        # TanStack Query hooks for dashboard data
    useEvents.ts           # TanStack Query hooks for email events
    useMailboxes.ts        # TanStack Query hooks for mailbox list
    useKillSwitch.ts       # Kill switch toggle mutation
  stores/
    authStore.ts           # Zustand: user, mailboxes, isLoading, isAuthenticated
    uiStore.ts             # Zustand: sidebarCollapsed, selectedMailboxId
  api/
    client.ts              # Fetch wrapper with credentials: 'include'
    dashboard.ts           # Dashboard API functions
    events.ts              # Email events API functions
    auth.ts                # Auth API functions (me, logout)
    mailboxes.ts           # Mailbox API functions
  lib/
    utils.ts               # shadcn cn() utility
    formatters.ts          # Date, email, number formatters
    constants.ts           # Event types, route paths, etc.
  App.tsx                  # Router setup + providers
  main.tsx                 # Entry point
  app.css                  # Tailwind import + shadcn theme variables
```

### Recommended Backend Additions

```
backend/src/
  config/
    socket.ts              # Socket.IO server initialization + auth middleware
  routes/
    dashboard.ts           # GET /api/dashboard/stats, GET /api/dashboard/activity
    events.ts              # GET /api/events (paginated, filterable)
  services/
    eventCollector.ts      # MODIFY: emit Socket.IO event after saving EmailEvent
```

### Pattern 1: Socket.IO Server with Cookie-Based JWT Auth

**What:** Attach Socket.IO to the existing HTTP server, authenticate connections using the existing httpOnly JWT cookie.
**When to use:** Always -- this is the only Socket.IO setup pattern for this project.

```typescript
// backend/src/config/socket.ts
import { Server as SocketServer } from 'socket.io';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { config } from './index.js';
import logger from './logger.js';
import type { JwtPayload } from '../auth/middleware.js';

export function createSocketServer(app: Express): { httpServer: HttpServer; io: SocketServer } {
  const httpServer = createServer(app);

  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.appUrl,
      credentials: true,
    },
    // No automatic cookie -- we read the existing msedb_session cookie
  });

  // Authenticate Socket.IO connections using existing JWT cookie
  io.use((socket, next) => {
    // Parse cookies from handshake headers
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) {
      return next(new Error('No session cookie'));
    }

    // Simple cookie parsing (or use cookie-parser)
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [key, ...val] = c.trim().split('=');
        return [key, val.join('=')];
      })
    );

    const token = cookies['msedb_session'];
    if (!token) {
      return next(new Error('No session token'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('Invalid or expired session'));
    }
  });

  // Join user-specific room on connection
  io.on('connection', (socket) => {
    const userId = socket.data.user.userId;
    socket.join(`user:${userId}`);
    logger.info('Socket.IO client connected', { userId });

    socket.on('disconnect', () => {
      logger.debug('Socket.IO client disconnected', { userId });
    });
  });

  return { httpServer, io };
}
```

**Critical integration note:** The backend `server.ts` currently calls `app.listen()` directly. This must change to `httpServer.listen()` because Socket.IO needs to attach to the HTTP server, not the Express app. The refactor is:
```typescript
// BEFORE (current):
app.listen(config.port, () => { ... });

// AFTER (with Socket.IO):
const { httpServer, io } = createSocketServer(app);
httpServer.listen(config.port, () => { ... });
```

### Pattern 2: Socket.IO Event Emission from Backend Services

**What:** After saving an EmailEvent, emit a Socket.IO event to the user's room.
**When to use:** In eventCollector.ts after successful saveEmailEvent().

```typescript
// Emit to user's room after saving event
import { getIO } from '../config/socket.js';

// In saveEmailEvent or processChangeNotification:
const saved = await saveEmailEvent(eventData);
if (saved) {
  const io = getIO();
  io.to(`user:${eventData.userId}`).emit('email:event', {
    id: savedEvent._id,
    eventType: eventData.eventType,
    sender: eventData.sender,
    subject: eventData.subject,
    timestamp: eventData.timestamp,
    mailboxId: eventData.mailboxId,
  });
}
```

### Pattern 3: Frontend Socket.IO Hook with TanStack Query Invalidation

**What:** Custom hook that connects to Socket.IO and invalidates relevant queries when events arrive.
**When to use:** In DashboardPage and EmailActivityPage components.

```typescript
// frontend/src/hooks/useSocket.ts
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = io({
      withCredentials: true,  // Send cookies with handshake
      // No URL needed -- defaults to same origin (nginx proxies)
    });

    socket.on('connect', () => {
      console.debug('Socket.IO connected');
    });

    socket.on('email:event', (event) => {
      // Invalidate dashboard stats and activity feed
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return socketRef;
}
```

### Pattern 4: Protected Routes with Auth Check

**What:** Wrap routes in an auth check that redirects to login if not authenticated.
**When to use:** All routes except /login.

```typescript
// frontend/src/App.tsx
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router';
import { useAuthStore } from '@/stores/authStore';

function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/activity', element: <EmailActivityPage /> },
      // Future pages (placeholder routes for sidebar nav)
      { path: '/patterns', element: <ComingSoon title="Patterns" /> },
      { path: '/rules', element: <ComingSoon title="Rules" /> },
      { path: '/staging', element: <ComingSoon title="Staging" /> },
      { path: '/audit', element: <ComingSoon title="Audit Log" /> },
      { path: '/settings', element: <ComingSoon title="Settings" /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
```

### Pattern 5: API Client with Credentials

**What:** Fetch wrapper that always includes credentials for httpOnly cookie auth.
**When to use:** All API calls from the frontend.

```typescript
// frontend/src/api/client.ts
const API_BASE = '/api';
const AUTH_BASE = '/auth';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith('/auth') ? `${AUTH_BASE}${path.slice(5)}` : `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',  // Always send cookies
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Session expired -- redirect to login
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
```

### Pattern 6: Nginx WebSocket Proxy

**What:** Nginx configuration to proxy Socket.IO WebSocket connections to backend.
**When to use:** Required for Socket.IO to work through nginx.

```nginx
# Add to nginx.conf -- Socket.IO proxy
location /socket.io/ {
    proxy_pass http://msedb-backend:8010/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

### Anti-Patterns to Avoid

- **Storing auth tokens in localStorage/sessionStorage:** The project uses httpOnly cookies. Never extract or store JWT tokens in JavaScript-accessible storage.
- **Creating Socket.IO connections in child components:** Only connect once at the app level (or in a top-level provider). Child components subscribe to events via the shared connection.
- **Polling for real-time updates:** Use Socket.IO invalidation to trigger TanStack Query refetches. Do not set up polling intervals.
- **Direct Mongoose calls from route handlers:** Use service functions. Route handlers call services, services call models.
- **Putting all state in Zustand:** Use TanStack Query for server state (API data). Use Zustand only for client-only state (UI preferences, selected mailbox, auth info).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UI component library | Custom buttons, cards, inputs, dialogs | shadcn/ui (npx shadcn@latest add ...) | Accessible, themed, Tailwind-native. Components are copied into project, fully customizable. |
| Data table with sort/filter/pagination | Custom table component | @tanstack/react-table + shadcn Table | Battle-tested headless table logic handles column definitions, sorting state, filter state, pagination math |
| Server state caching | Custom fetch + useState | @tanstack/react-query | Handles caching, refetching, stale data, loading/error states, cache invalidation, background refetching |
| Client-side routing | Custom history management | react-router v7 | Handles URL matching, nested layouts, redirects, lazy loading, scroll restoration |
| Date formatting | Custom date string manipulation | date-fns format/formatDistanceToNow | Handles timezones, locales, relative time ("2 min ago"), edge cases |
| WebSocket reconnection | Custom WebSocket with retry logic | socket.io-client | Handles reconnection, fallback to long-polling, heartbeat, automatic reconnection with backoff |
| Charts/visualizations | Custom SVG rendering | Recharts via shadcn Chart | Responsive containers, tooltips, animations, axis formatting, legend |
| Form validation | Custom validation logic | React Hook Form (if needed in future) | Not needed in Phase 4 but should not be hand-rolled when forms arrive in later phases |

**Key insight:** This phase is almost entirely about composition -- wiring together well-established libraries into the project's specific layout and data flow. There is very little novel logic; the complexity is in the integration and the Socket.IO plumbing.

## Common Pitfalls

### Pitfall 1: Socket.IO Connection Through Nginx Without WebSocket Headers

**What goes wrong:** Socket.IO falls back to HTTP long-polling instead of WebSocket, causing high latency and server load.
**Why it happens:** Nginx strips the `Upgrade` and `Connection` headers by default because they are hop-by-hop headers.
**How to avoid:** Add the `/socket.io/` location block to nginx.conf with `proxy_http_version 1.1`, `Upgrade $http_upgrade`, and `Connection "upgrade"` headers. Set `proxy_read_timeout` to a high value (86400s) to prevent nginx from closing idle WebSocket connections.
**Warning signs:** Network tab shows repeated `/socket.io/?transport=polling` requests instead of a single WebSocket connection.

### Pitfall 2: Socket.IO Duplicate Event Listeners on React Re-render

**What goes wrong:** Events fire multiple times, causing UI flicker and incorrect state.
**Why it happens:** useEffect cleanup not properly removing event listeners, or using anonymous functions that cannot be removed with `socket.off()`.
**How to avoid:** Always use named function references in `socket.on()` and remove them in the useEffect cleanup with `socket.off(eventName, namedFunction)`. Create the socket connection exactly once (in a top-level hook or provider), not per-component.
**Warning signs:** Console shows the same event logged multiple times, activity feed shows duplicates.

### Pitfall 3: TanStack Query Cache Invalidation Race with Socket.IO

**What goes wrong:** Socket.IO event arrives and invalidates query, but the query refetches before the backend has committed the new data.
**Why it happens:** Socket.IO event is emitted in the fire-and-forget async block of the webhook handler. The event may arrive at the frontend before the database write is visible.
**How to avoid:** Emit Socket.IO events AFTER the EmailEvent is successfully saved (inside saveEmailEvent or after its await). Use TanStack Query's `invalidateQueries` which refetches in the background -- the UI shows stale data briefly then updates. This is acceptable UX.
**Warning signs:** Dashboard briefly shows old count, then updates to new count a moment later.

### Pitfall 4: Express app.listen() vs httpServer.listen() with Socket.IO

**What goes wrong:** Socket.IO server never receives connections. Frontend gets connection refused errors.
**Why it happens:** Socket.IO must attach to the raw Node.js HTTP server, not the Express app. `app.listen()` creates its own HTTP server internally, but Socket.IO is attached to a different one.
**How to avoid:** Create the HTTP server explicitly with `createServer(app)`, attach Socket.IO to it, then call `httpServer.listen()` instead of `app.listen()`.
**Warning signs:** Backend starts without errors but Socket.IO connections fail silently. Health endpoint works but /socket.io/ returns 404.

### Pitfall 5: shadcn/ui Init Overwrites Existing Tailwind Config

**What goes wrong:** Running `npx shadcn@latest init` modifies the CSS file and may conflict with existing Tailwind v4 setup.
**Why it happens:** shadcn init writes CSS variables and theme configuration to the main CSS file.
**How to avoid:** The existing `app.css` only has `@import "tailwindcss"`. shadcn init will add theme variables below this import. Review the changes after init. With Tailwind v4, shadcn uses the `@theme` directive in CSS (no tailwind.config.js). This is compatible with the existing `@tailwindcss/vite` plugin.
**Warning signs:** Build errors about unknown at-rules or missing CSS variables after init.

### Pitfall 6: Recharts Empty Charts with React 19

**What goes wrong:** Charts render as empty containers with no visible bars, lines, or areas.
**Why it happens:** Recharts internally depends on `react-is` which must match the React version exactly.
**How to avoid:** Install `react-is@19.0.0` explicitly and add npm overrides in package.json: `"overrides": { "react-is": "$react-is" }`. Run `npm install` after adding overrides to rebuild the lockfile.
**Warning signs:** Chart container renders with correct dimensions but no visible data elements.

### Pitfall 7: Path Aliases Not Resolved

**What goes wrong:** TypeScript and Vite don't resolve `@/` imports.
**Why it happens:** The current tsconfig.json and vite.config.ts do not have path alias configuration. shadcn/ui requires `@/` to resolve to `./src/`.
**How to avoid:** Add `baseUrl` and `paths` to tsconfig.json and tsconfig.app.json. Add `resolve.alias` to vite.config.ts. Install `@types/node` for `path.resolve`.
**Warning signs:** Build error: "Cannot find module '@/components/ui/button'" or similar.

## Code Examples

### Backend: Dashboard Stats API Endpoint

```typescript
// backend/src/routes/dashboard.ts
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';
import { Mailbox } from '../models/Mailbox.js';

const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregate stats for the user's mailboxes.
 * Optional ?mailboxId= filter for per-mailbox view.
 */
dashboardRouter.get('/stats', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxId = req.query.mailboxId as string | undefined;

  const match: Record<string, unknown> = { userId };
  if (mailboxId) match.mailboxId = mailboxId;

  const [emailsProcessed, perMailboxCounts] = await Promise.all([
    EmailEvent.countDocuments(match),
    EmailEvent.aggregate([
      { $match: match },
      { $group: { _id: '$mailboxId', count: { $sum: 1 } } },
    ]),
  ]);

  // Get mailbox info for labels
  const mailboxes = await Mailbox.find({ userId }).select('email displayName').lean();
  const mailboxMap = Object.fromEntries(
    mailboxes.map(m => [m._id.toString(), { email: m.email, displayName: m.displayName }])
  );

  res.json({
    emailsProcessed,
    rulesFired: 0,        // Phase 6 will populate
    patternsPending: 0,   // Phase 5 will populate
    stagingCount: 0,      // Phase 6 will populate
    perMailbox: perMailboxCounts.map(pc => ({
      mailboxId: pc._id,
      ...mailboxMap[pc._id.toString()],
      count: pc.count,
    })),
  });
});

/**
 * GET /api/dashboard/activity
 *
 * Returns the most recent email events across all mailboxes.
 * Optional ?mailboxId= filter. Default limit 50.
 */
dashboardRouter.get('/activity', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxId = req.query.mailboxId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const match: Record<string, unknown> = { userId };
  if (mailboxId) match.mailboxId = mailboxId;

  const events = await EmailEvent.find(match)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('eventType sender subject timestamp mailboxId fromFolder toFolder')
    .lean();

  res.json({ events });
});
```

### Backend: Email Events API Endpoint (Paginated + Filterable)

```typescript
// backend/src/routes/events.ts
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { EmailEvent } from '../models/EmailEvent.js';

const eventsRouter = Router();
eventsRouter.use(requireAuth);

/**
 * GET /api/events
 *
 * Paginated, filterable email events.
 * Query params: mailboxId, eventType, senderDomain, page (1-based), limit, sortBy, sortOrder
 */
eventsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    mailboxId,
    eventType,
    senderDomain,
    page = '1',
    limit = '50',
    sortBy = 'timestamp',
    sortOrder = 'desc',
  } = req.query as Record<string, string>;

  const match: Record<string, unknown> = { userId };
  if (mailboxId) match.mailboxId = mailboxId;
  if (eventType) match.eventType = eventType;
  if (senderDomain) match['sender.domain'] = senderDomain;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
  const skip = (pageNum - 1) * limitNum;
  const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [events, total] = await Promise.all([
    EmailEvent.find(match)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .select('eventType sender subject timestamp mailboxId fromFolder toFolder importance hasAttachments categories isRead')
      .lean(),
    EmailEvent.countDocuments(match),
  ]);

  res.json({
    events,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * GET /api/events/sender-breakdown
 *
 * Aggregated sender domain counts for charts.
 */
eventsRouter.get('/sender-breakdown', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxId = req.query.mailboxId as string | undefined;

  const match: Record<string, unknown> = { userId };
  if (mailboxId) match.mailboxId = mailboxId;

  const breakdown = await EmailEvent.aggregate([
    { $match: match },
    { $group: { _id: '$sender.domain', count: { $sum: 1 }, latestEvent: { $max: '$timestamp' } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  res.json({ breakdown });
});

/**
 * GET /api/events/timeline
 *
 * Hourly event counts for the last 24 hours (or daily for last 30 days).
 */
eventsRouter.get('/timeline', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const mailboxId = req.query.mailboxId as string | undefined;
  const range = (req.query.range as string) || '24h';

  const match: Record<string, unknown> = { userId };
  if (mailboxId) match.mailboxId = mailboxId;

  const now = new Date();
  let groupBy: Record<string, unknown>;
  let since: Date;

  if (range === '30d') {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } };
  } else {
    since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    groupBy = { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' } };
  }

  match.timestamp = { $gte: since };

  const timeline = await EmailEvent.aggregate([
    { $match: match },
    { $group: { _id: groupBy, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({ timeline, range });
});
```

### Frontend: Auth Store with Zustand

```typescript
// frontend/src/stores/authStore.ts
import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  preferences: {
    automationPaused: boolean;
  };
}

interface MailboxInfo {
  id: string;
  email: string;
  displayName: string;
  isConnected: boolean;
}

interface AuthState {
  user: User | null;
  mailboxes: MailboxInfo[];
  isLoading: boolean;
  isAuthenticated: boolean;
  setAuth: (user: User, mailboxes: MailboxInfo[]) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  mailboxes: [],
  isLoading: true,
  isAuthenticated: false,
  setAuth: (user, mailboxes) => set({ user, mailboxes, isAuthenticated: true, isLoading: false }),
  clearAuth: () => set({ user: null, mailboxes: [], isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));
```

### Frontend: shadcn/ui Stats Card Component

```typescript
// frontend/src/components/dashboard/StatsCards.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Brain, Clock, Shield } from 'lucide-react';

interface StatsCardsProps {
  emailsProcessed: number;
  rulesFired: number;
  patternsPending: number;
  stagingCount: number;
}

export function StatsCards({ emailsProcessed, rulesFired, patternsPending, stagingCount }: StatsCardsProps) {
  const stats = [
    { title: 'Emails Processed', value: emailsProcessed, icon: Mail, color: 'text-blue-500' },
    { title: 'Rules Fired', value: rulesFired, icon: Shield, color: 'text-green-500' },
    { title: 'Patterns Pending', value: patternsPending, icon: Brain, color: 'text-yellow-500' },
    { title: 'In Staging', value: stagingCount, icon: Clock, color: 'text-orange-500' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-router-dom (separate package) | react-router (consolidated) | React Router v7 (2024) | Install `react-router` not `react-router-dom`. All imports from `react-router`. |
| tailwind.config.js | CSS-first config via @theme directive | Tailwind v4 (Feb 2025) | No config file. Theme in CSS. shadcn/ui handles this automatically with `init`. |
| HSL colors in shadcn/ui | OKLCH colors | shadcn Tailwind v4 update (Feb 2025) | Color variables use oklch() format in CSS. |
| forwardRef in React | Direct ref prop | React 19 (2024) | shadcn/ui v4 components remove forwardRef, use direct ref prop. |
| shadcn "default" style | "new-york" style only | shadcn 2025 | Default style deprecated. New projects use new-york. |
| toast component (shadcn) | sonner component | shadcn 2025 | Toast deprecated in favor of sonner for notifications. |
| gcTime (React Query) | Same name, was cacheTime | TanStack Query v5 (2023) | `cacheTime` renamed to `gcTime`. |

**Deprecated/outdated:**
- `react-router-dom` package: Merged into `react-router` in v7. Still works but deprecated.
- `tailwind.config.js`: Replaced by CSS-first configuration in Tailwind v4.
- shadcn `toast` component: Deprecated, use `sonner` instead.
- `React.forwardRef()`: No longer needed in React 19.

## shadcn/ui Components Needed

These components should be added via `npx shadcn@latest add <name>`:

| Component | Used For |
|-----------|----------|
| button | All interactive buttons |
| card | Dashboard stats cards, info cards |
| table | Email events table base |
| badge | Event type badges, status indicators |
| separator | Visual section dividers |
| dropdown-menu | User menu, mailbox selector |
| switch | Kill switch toggle |
| select | Filter dropdowns (event type, mailbox) |
| skeleton | Loading placeholders |
| sonner | Toast notifications (for Socket.IO events) |
| tooltip | Icon button tooltips |
| sidebar | Navigation sidebar (shadcn/ui has a sidebar component) |
| chart | Recharts wrapper with theme integration |
| avatar | User avatar in topbar |
| input | Search/filter inputs |
| scroll-area | Scrollable activity feed |
| pagination | Table pagination controls |

Install all at once:
```bash
npx shadcn@latest add button card table badge separator dropdown-menu switch select skeleton sonner tooltip sidebar chart avatar input scroll-area
```

Note: `pagination` may not be a separate shadcn component -- implement using Button components with prev/next logic.

## Open Questions

1. **Kill switch scope: user-level vs global**
   - What we know: User model has `preferences.automationPaused` (user-level). Mailbox model has `settings.automationPaused` (per-mailbox). SAFE-02 says "pause ALL automation across all mailboxes."
   - What's unclear: Should the kill switch in the top nav toggle the user-level preference (pausing all their mailboxes) or should it be more granular?
   - Recommendation: The top nav kill switch toggles `User.preferences.automationPaused` which pauses ALL automation for that user across all mailboxes. This is the simplest interpretation of SAFE-02 and matches the "not buried in settings" requirement. Per-mailbox pause can be added in Phase 6/7 settings page.

2. **Kill switch API endpoint**
   - What we know: No PATCH /api/settings or toggle endpoint exists yet.
   - What's unclear: Should we create a dedicated endpoint or a general settings update?
   - Recommendation: Create `PATCH /api/user/preferences` that accepts `{ automationPaused: boolean }` and updates `User.preferences`. Keep it generic for future preference updates. The kill switch UI calls this endpoint.

3. **Dashboard stats for Phase 4 scope**
   - What we know: DASH-01 lists "rules fired, patterns pending, staging count" but these features don't exist until Phase 5/6.
   - What's unclear: Should the cards show 0 or be hidden until those features exist?
   - Recommendation: Show all four cards with 0 values for rules/patterns/staging. This establishes the UI layout and the stat values will automatically populate when Phase 5/6 build the relevant features. The API returns 0 for these until then.

## Sources

### Primary (HIGH confidence)
- [shadcn/ui Vite installation guide](https://ui.shadcn.com/docs/installation/vite) - Complete setup steps for shadcn with Vite, Tailwind v4
- [shadcn/ui Tailwind v4 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) - Tailwind v4 support details, OKLCH colors, @theme directive
- [shadcn/ui Data Table guide](https://ui.shadcn.com/docs/components/radix/data-table) - TanStack Table integration pattern
- [Socket.IO React guide](https://socket.io/how-to/use-with-react) - Official hook patterns, cleanup, connection management
- [Socket.IO Middlewares](https://socket.io/docs/v4/middlewares/) - io.use() vs io.engine.use(), authentication patterns
- [Socket.IO Cookie handling](https://socket.io/how-to/deal-with-cookies) - Cookie configuration, credentials, CORS
- [Socket.IO JWT guide](https://socket.io/how-to/use-with-jwt) - JWT auth middleware, token passing, user rooms
- [Socket.IO Server options](https://socket.io/docs/v4/server-options/) - CORS, allowRequest, cookie config
- [React Router v7 upgrade guide](https://reactrouter.com/upgrading/v6) - Package consolidation, import changes
- [TanStack Query v5 overview](https://tanstack.com/query/v5/docs/framework/react/overview) - Setup, QueryClient, hooks

### Secondary (MEDIUM confidence)
- [Recharts React 19 issue #4558](https://github.com/recharts/recharts/issues/4558) - react-is override solution
- [shadcn/ui React 19 page](https://ui.shadcn.com/docs/react-19) - react-is override for recharts
- [Zustand v5 migration guide](https://zustand.docs.pmnd.rs/migrations/migrating-to-v5) - TypeScript patterns, behavioral changes
- npm package pages for version numbers (socket.io 4.8.3, react-router 7.13.0, @tanstack/react-query 5.90.x, @tanstack/react-table 8.21.x, recharts 3.7.0, zustand 5.x)

### Tertiary (LOW confidence)
- nginx WebSocket proxy configuration - Verified against official nginx.org docs and Socket.IO reverse proxy guide, but production timeout values may need tuning

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via npm and official docs. Versions confirmed current.
- Architecture: HIGH - Patterns follow official guides (shadcn, Socket.IO, TanStack Query). Backend integration pattern (httpServer) is well-documented.
- Pitfalls: HIGH - All pitfalls verified via official documentation or issue trackers. Recharts/React 19 issue confirmed in GitHub issues.
- Socket.IO cookie auth: MEDIUM - The pattern of reading httpOnly cookies from `socket.handshake.headers.cookie` is documented but the exact cookie-parser integration may need minor adjustments during implementation.

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (30 days -- these are stable libraries with infrequent breaking changes)
