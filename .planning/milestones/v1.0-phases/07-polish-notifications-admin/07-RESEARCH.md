# Phase 7: Polish, Notifications & Admin - Research

**Researched:** 2026-02-17
**Domain:** In-app notification system, settings page, admin panel (React + Express + MongoDB + Socket.IO)
**Confidence:** HIGH

## Summary

Phase 7 completes the three remaining UI pages (Settings, Admin Panel) and builds the in-app notification system. The codebase is already well-structured for this work: the Notification Mongoose model exists with proper indexes and a 30-day TTL, Socket.IO is wired with per-user rooms (`user:{userId}`), the admin routes already handle invite/deactivate/role-change, and the user preferences route handles the kill switch. The frontend uses TanStack Query for data fetching, Zustand for client state, shadcn/ui for components, and react-router v7 for routing.

This phase is primarily a UI-building and API-expansion exercise. The notification system needs backend CRUD routes, a Socket.IO event channel for real-time delivery, and a frontend bell icon with dropdown. The settings page needs to expand the existing `/api/user/preferences` endpoint to handle all preference fields (working hours, aggressiveness) and expose per-mailbox connection status and whitelist management. The admin panel needs new aggregate analytics and system health endpoints, plus org-wide rule CRUD and a user management UI.

**Primary recommendation:** Build in three layers -- (1) backend API routes and notification service first, (2) Socket.IO notification delivery plumbing, (3) frontend pages consuming those APIs. Lean heavily on existing patterns (TanStack Query hooks, shadcn/ui components, the established router/model/service architecture).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-03 | In-app notification system (bell icon) with read/unread state for pattern suggestions, rule executions, staging alerts, and system events | Notification model already exists with types, read/unread state, priority, relatedEntity, and TTL index. Socket.IO rooms exist per user. Need: notification CRUD routes, Socket.IO `notification:new` event, frontend bell icon + dropdown + notification store |
| PAGE-06 | Settings page -- preferences, working hours, automation aggressiveness, per-mailbox connection status and management, whitelist management, data export/delete | User model has `preferences` with `workingHoursStart`, `workingHoursEnd`, `aggressiveness`. Mailbox model tracks `isConnected`, `encryptedTokens.expiresAt`, `settings.whitelistedSenders/Domains`. User route only handles `automationPaused` currently -- needs expansion. Data export/delete needs new endpoints |
| PAGE-07 | Admin panel -- user invite/deactivate/role management, org-wide rules, aggregate analytics, system health (webhook status, token health, subscription expiry) | Admin routes exist for invite/users/role/deactivate. Rule model has `scope: 'user' | 'org'` field. Health endpoint exists with mongo/redis/subscription/token stats. Need: admin analytics endpoint (aggregate across users), org-wide rule CRUD, system health detail endpoint (per-mailbox webhook status, per-user token health), admin UI page |
</phase_requirements>

## Standard Stack

### Core (Already Installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.x | UI framework | Already in use across all pages |
| TanStack Query | 5.90.x | Server state management | All data fetching uses this pattern |
| Zustand | 5.x | Client state (auth, UI, notifications) | Already used for authStore, uiStore |
| shadcn/ui | 3.8.x (CLI) + radix-ui 1.4.x | UI components | All UI built with shadcn components |
| Socket.IO | 4.8.x | Real-time events | Already wired with per-user rooms |
| Express | 5.x | Backend API routes | All routes follow established pattern |
| Mongoose | ODM | MongoDB models | All models follow established schema pattern |
| lucide-react | 0.574.x | Icons | Used throughout the app (Bell, Settings, Shield, etc.) |
| date-fns | 4.1.x | Date formatting | Already installed and used |
| recharts | 2.15.x | Charts/graphs | Already installed, used in dashboard |
| sonner | 2.x | Toast notifications | Already installed and configured |

### New shadcn/ui Components Needed

| Component | Purpose | Installation |
|-----------|---------|-------------|
| `popover` | Bell icon notification dropdown | `npx shadcn@latest add popover` |
| `tabs` | Settings page sections, admin panel tabs | `npx shadcn@latest add tabs` |
| `dialog` | Confirmation dialogs (data delete, user deactivate) | `npx shadcn@latest add dialog` |
| `label` | Form field labels in settings | `npx shadcn@latest add label` |
| `slider` | Working hours range selector | `npx shadcn@latest add slider` |
| `radio-group` | Aggressiveness level selector | `npx shadcn@latest add radio-group` |
| `textarea` | Whitelist bulk entry | `npx shadcn@latest add textarea` |
| `progress` | Token health/expiry visualization | `npx shadcn@latest add progress` |

**Installation:**
```bash
cd frontend && npx shadcn@latest add popover tabs dialog label slider radio-group textarea progress
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand notification store | TanStack Query only | Zustand preferred for notification unread count (needs to be reactive across components without prop drilling, bell icon in Topbar + dropdown + pages all need count) |
| Custom notification dropdown | Third-party notification library | Custom is better -- matches existing shadcn/ui patterns, avoids dependency for a simple dropdown |
| Separate notification polling | Socket.IO push | Socket.IO already established; push is superior for real-time UX |

## Architecture Patterns

### Recommended Project Structure (New Files)

```
backend/src/
  routes/
    notifications.ts       # CRUD: list, mark-read, mark-all-read, delete
    settings.ts            # Full settings: preferences, connection, export, delete
  services/
    notificationService.ts # Create + emit notifications (reusable by all producers)
    adminService.ts        # Aggregate analytics, system health detail queries

frontend/src/
  api/
    notifications.ts       # API client for notification endpoints
    settings.ts            # API client for settings endpoints
    admin.ts               # API client for admin endpoints
  hooks/
    useNotifications.ts    # TanStack Query + Zustand for notification state
    useSettings.ts         # TanStack Query hooks for settings CRUD
    useAdmin.ts            # TanStack Query hooks for admin panel data
  stores/
    notificationStore.ts   # Zustand: unread count, dropdown open state
  pages/
    SettingsPage.tsx        # Replace ComingSoonPage
    AdminPage.tsx           # New page (admin-only route)
  components/
    notifications/
      NotificationBell.tsx  # Bell icon with unread badge (in Topbar)
      NotificationDropdown.tsx  # Popover dropdown listing recent notifications
      NotificationItem.tsx  # Single notification row
    settings/
      PreferencesSection.tsx    # Working hours, aggressiveness
      MailboxSection.tsx        # Per-mailbox connection status, reconnect, disconnect
      WhitelistSection.tsx      # Per-mailbox + org whitelist management
      DataManagement.tsx        # Export/delete user data
    admin/
      UserManagement.tsx        # Invite, deactivate, role change table
      OrgRulesSection.tsx       # Org-wide rule CRUD
      AnalyticsSection.tsx      # Aggregate stats
      SystemHealthSection.tsx   # Webhook + token health dashboard
```

### Pattern 1: Notification Service (Backend)

**What:** A centralized service that creates notification documents AND emits Socket.IO events in one call. All notification producers (tokenRefresh job, patternAnalysis job, actionExecutor, stagingProcessor) call this service instead of directly creating Notification documents.

**When to use:** Every time a notification needs to be sent to a user.

**Example:**
```typescript
// backend/src/services/notificationService.ts
import { Notification, type INotification } from '../models/Notification.js';
import { getIO } from '../config/socket.js';
import logger from '../config/logger.js';

interface CreateNotificationParams {
  userId: string;
  type: INotification['type'];
  title: string;
  message: string;
  priority?: INotification['priority'];
  relatedEntity?: INotification['relatedEntity'];
}

export async function createNotification(params: CreateNotificationParams): Promise<INotification> {
  const notification = await Notification.create({
    userId: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    priority: params.priority ?? 'normal',
    relatedEntity: params.relatedEntity,
  });

  // Emit via Socket.IO for real-time delivery
  try {
    const io = getIO();
    io.to(`user:${params.userId}`).emit('notification:new', {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      isRead: false,
      createdAt: notification.createdAt,
      relatedEntity: notification.relatedEntity,
    });
  } catch {
    // Socket.IO not initialized (tests) -- silent
  }

  return notification;
}
```

### Pattern 2: Notification Bell with Zustand + TanStack Query Hybrid

**What:** Use Zustand for the unread count (fast, reactive, accessible from Topbar) and TanStack Query for the full notification list (fetched on dropdown open, paginated).

**When to use:** The bell icon needs instant unread count updates; the dropdown needs paginated data.

**Example:**
```typescript
// frontend/src/stores/notificationStore.ts
import { create } from 'zustand';

interface NotificationState {
  unreadCount: number;
  isDropdownOpen: boolean;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  setDropdownOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,
  isDropdownOpen: false,
  setUnreadCount: (count) => set({ unreadCount: count }),
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  setDropdownOpen: (open) => set({ isDropdownOpen: open }),
}));
```

### Pattern 3: Socket.IO Notification Listener (Extend useSocket)

**What:** Extend the existing `useSocket` hook to listen for `notification:new` events and update the Zustand notification store.

**When to use:** Already called in `ProtectedLayout` -- just add the listener.

**Example:**
```typescript
// In useSocket.ts -- add after existing listeners
socket.on('notification:new', (notification) => {
  // Increment Zustand unread count
  useNotificationStore.getState().incrementUnread();
  // Invalidate notification queries so dropdown refetches
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
});
```

### Pattern 4: Admin Route Guard (Frontend)

**What:** Protect admin routes at the router level by checking `user.role` from authStore.

**When to use:** AdminPage route in App.tsx.

**Example:**
```typescript
// In App.tsx router config
{
  path: '/admin',
  element: <AdminGuard />,
}

// AdminGuard component
function AdminGuard() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <AdminPage />;
}
```

### Pattern 5: Settings Preference Update (Expand Existing Route)

**What:** Expand the existing `PATCH /api/user/preferences` to accept all preference fields, not just `automationPaused`.

**When to use:** Settings page saves.

**Example:**
```typescript
// Expand userRouter.patch('/preferences') to handle:
// { automationPaused?, workingHoursStart?, workingHoursEnd?, aggressiveness? }
// Use Mongoose $set with only the fields that were provided
const updateFields: Record<string, unknown> = {};
if (typeof automationPaused === 'boolean') updateFields['preferences.automationPaused'] = automationPaused;
if (typeof workingHoursStart === 'number') updateFields['preferences.workingHoursStart'] = workingHoursStart;
if (typeof workingHoursEnd === 'number') updateFields['preferences.workingHoursEnd'] = workingHoursEnd;
if (aggressiveness) updateFields['preferences.aggressiveness'] = aggressiveness;
```

### Anti-Patterns to Avoid

- **Polling for notifications:** Do NOT poll `/api/notifications/unread-count` on an interval. Socket.IO already pushes `notification:new` events in real-time. Only fetch the full count once on page load, then increment via Socket.IO events.

- **Creating notifications without the service:** Do NOT directly `Notification.create()` from routes or jobs. Always use the centralized `notificationService.createNotification()` so Socket.IO emission is guaranteed.

- **Putting admin logic in the frontend:** Role-based access MUST be enforced on the backend with `requireAdmin` middleware. Frontend guards are a UX convenience only -- never a security boundary.

- **Blocking settings save on each field change:** Do NOT auto-save on every keystroke. Use a form with a save button. Working hours, aggressiveness, etc. should be batched in a single PATCH request.

- **Fetching all notifications on every page load:** Fetch unread count only on initial load (single lightweight query). Full notification list is fetched lazily when the dropdown is opened.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Notification dropdown UI | Custom dropdown from scratch | shadcn/ui Popover + ScrollArea | Accessible, keyboard-navigable, consistent with rest of UI |
| Data export | Custom file generation | JSON.stringify + Blob download | User data is already structured in Mongoose models; just query, serialize, and create a downloadable Blob |
| Notification badge count | Custom polling loop | Socket.IO push + Zustand store | Existing real-time infra handles this with zero polling overhead |
| Admin user table | Custom table component | shadcn/ui Table (already installed) | Already used in Events table pattern |
| Time range picker | Custom slider implementation | shadcn/ui Slider (two-thumb) | Working hours needs a 0-23 range, slider handles this cleanly |
| Confirmation dialogs | Custom modal | shadcn/ui AlertDialog (already installed) | Used for destructive actions (delete data, deactivate user) |

**Key insight:** Every UI pattern needed in Phase 7 has an existing analog in the codebase (table in events page, cards in dashboard, forms in patterns customize dialog, dropdowns in topbar). The work is assembly, not invention.

## Common Pitfalls

### Pitfall 1: Notification Count Desync
**What goes wrong:** The Zustand unread count gets out of sync with the database count -- e.g., user opens notifications in another tab, or a notification expires via TTL.
**Why it happens:** Socket.IO push only handles new notifications. Other state changes (mark-read in another tab, TTL expiry) are not pushed.
**How to avoid:** Fetch the canonical unread count from the API on: (a) initial page load, (b) when the notification dropdown is opened, (c) after a mark-read/mark-all-read mutation. Socket.IO only handles the incremental `+1` for truly new notifications.
**Warning signs:** Unread badge shows stale count after navigating between pages or after a long idle period.

### Pitfall 2: Admin Panel Data Leakage
**What goes wrong:** Admin endpoints return sensitive user data (tokens, MSAL cache) in API responses.
**Why it happens:** Using `User.find()` without `.select()` returns all fields.
**How to avoid:** Always use `.select()` on admin queries to return only display fields: `email`, `displayName`, `role`, `isActive`, `lastLoginAt`, `createdAt`. NEVER return `encryptedTokens`, `msalCache`, or `preferences` for other users.
**Warning signs:** Network tab shows token data in admin API responses.

### Pitfall 3: Settings Page Overwrites Kill Switch
**What goes wrong:** The settings page sends a full preferences object that overwrites the kill switch state set from the Topbar.
**Why it happens:** Settings page fetches preferences on load, user changes aggressiveness, saves -- but the automationPaused field was stale from the original fetch.
**How to avoid:** Two approaches: (a) only send changed fields in the PATCH request (recommended, aligns with existing pattern), or (b) re-fetch current state before save. The backend route should use `$set` on individual fields, not replace the entire preferences object.
**Warning signs:** Kill switch toggles unexpectedly after saving settings.

### Pitfall 4: Data Export Timeout
**What goes wrong:** Exporting all user data (events, patterns, rules, audit logs) takes too long for a synchronous HTTP request, causing a timeout.
**Why it happens:** A user with 10,000+ email events generates a large response.
**How to avoid:** Stream the export as NDJSON or use pagination. For MVP, add a reasonable limit (e.g., last 90 days) and use `lean()` + `cursor()` for memory efficiency. If the export is very large, consider a BullMQ job that generates the file and notifies when ready.
**Warning signs:** 504 Gateway Timeout on export endpoint.

### Pitfall 5: Admin Nav Item Visible to Non-Admins
**What goes wrong:** Non-admin users see the "Admin Panel" link in the sidebar, click it, and get an error.
**Why it happens:** Sidebar items are statically defined in `NAV_ITEMS` without role filtering.
**How to avoid:** Filter `NAV_ITEMS` based on `user.role` from authStore. Add an `adminOnly?: boolean` flag to the NavItem type and filter before rendering.
**Warning signs:** Non-admin users see admin link in sidebar.

### Pitfall 6: Socket.IO Room Not Joined After Reconnect
**What goes wrong:** After a Socket.IO reconnection (network blip), the client may not be in the user room, so notification pushes are lost.
**Why it happens:** Socket.IO reconnects automatically, but room joins happen only on initial connection in the server's `connection` handler.
**How to avoid:** The server-side `connection` handler already joins the user to `user:{userId}` on every connection (including reconnections). This is already correctly implemented. Just verify that the client's `useRef` pattern in `useSocket.ts` handles reconnection properly -- Socket.IO's auto-reconnect creates a new connection event on the server, which re-triggers the room join.
**Warning signs:** Notifications stop appearing after a network interruption.

## Code Examples

### Notification CRUD Routes

```typescript
// backend/src/routes/notifications.ts
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { Notification } from '../models/Notification.js';

const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// GET /api/notifications?limit=20&offset=0
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = parseInt(req.query.offset as string) || 0;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    Notification.countDocuments({ userId }),
    Notification.countDocuments({ userId, isRead: false }),
  ]);

  res.json({ notifications, total, unreadCount });
});

// GET /api/notifications/unread-count
notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  const count = await Notification.countDocuments({
    userId: req.user!.userId,
    isRead: false,
  });
  res.json({ count });
});

// PATCH /api/notifications/:id/read
notificationsRouter.patch('/:id/read', async (req: Request, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.userId },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  if (!notification) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(notification);
});

// PATCH /api/notifications/read-all
notificationsRouter.patch('/read-all', async (req: Request, res: Response) => {
  await Notification.updateMany(
    { userId: req.user!.userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );
  res.json({ success: true });
});

export { notificationsRouter };
```

### Admin Analytics Endpoint

```typescript
// Extension to backend/src/routes/admin.ts
// GET /api/admin/analytics
adminRouter.get('/analytics', async (_req: Request, res: Response) => {
  const [
    totalUsers,
    activeUsers,
    totalEvents,
    totalRules,
    totalPatterns,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    EmailEvent.countDocuments(),
    Rule.countDocuments({ isEnabled: true }),
    Pattern.countDocuments({ status: { $in: ['detected', 'suggested'] } }),
  ]);

  res.json({
    totalUsers,
    activeUsers,
    totalEvents,
    totalRules,
    totalPatterns,
  });
});
```

### Admin System Health Endpoint

```typescript
// GET /api/admin/health
adminRouter.get('/health', async (_req: Request, res: Response) => {
  // Per-mailbox webhook subscription status
  const subscriptions = await WebhookSubscription.find()
    .populate('mailboxId', 'email displayName')
    .populate('userId', 'email displayName')
    .select('subscriptionId status expiresAt lastNotificationAt errorCount mailboxId userId')
    .lean();

  // Per-user token health
  const mailboxes = await Mailbox.find()
    .populate('userId', 'email displayName')
    .select('email isConnected encryptedTokens.expiresAt userId lastSyncAt')
    .lean();

  const tokenHealth = mailboxes.map((m) => ({
    mailboxId: m._id,
    email: m.email,
    user: m.userId,
    isConnected: m.isConnected,
    tokenExpiresAt: m.encryptedTokens?.expiresAt,
    tokenHealthy: m.isConnected && m.encryptedTokens?.expiresAt
      ? new Date(m.encryptedTokens.expiresAt) > new Date()
      : false,
    lastSyncAt: m.lastSyncAt,
  }));

  res.json({ subscriptions, tokenHealth });
});
```

### Notification Bell Component Pattern

```typescript
// frontend/src/components/notifications/NotificationBell.tsx
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useNotificationStore } from '@/stores/notificationStore';

export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isOpen = useNotificationStore((s) => s.isDropdownOpen);
  const setOpen = useNotificationStore((s) => s.setDropdownOpen);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative rounded-full p-2 hover:bg-accent">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {/* NotificationDropdown component goes here */}
      </PopoverContent>
    </Popover>
  );
}
```

### Data Export Endpoint Pattern

```typescript
// GET /api/settings/export-data
settingsRouter.get('/export-data', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const [user, mailboxes, rules, patterns, events] = await Promise.all([
    User.findById(userId).select('email displayName preferences createdAt').lean(),
    Mailbox.find({ userId }).select('email displayName settings createdAt').lean(),
    Rule.find({ userId }).select('-__v').lean(),
    Pattern.find({ userId }).select('-__v').lean(),
    EmailEvent.find({ userId }).sort({ timestamp: -1 }).limit(10000).select('-__v').lean(),
  ]);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="msedb-export-${new Date().toISOString().slice(0, 10)}.json"`,
  );

  res.json({ exportedAt: new Date().toISOString(), user, mailboxes, rules, patterns, events });
});
```

### Data Delete Endpoint Pattern

```typescript
// DELETE /api/settings/delete-data
settingsRouter.delete('/delete-data', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // Delete all user data across collections
  await Promise.all([
    EmailEvent.deleteMany({ userId }),
    Pattern.deleteMany({ userId }),
    Rule.deleteMany({ userId }),
    StagedEmail.deleteMany({ userId }),
    AuditLog.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    WebhookSubscription.deleteMany({ userId }),
    Mailbox.deleteMany({ userId }),
  ]);

  // Finally delete the user record
  await User.findByIdAndDelete(userId);

  // Clear the session cookie
  res.clearCookie('msedb_session');
  res.json({ message: 'All data deleted successfully' });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling for notifications | Socket.IO push + on-demand fetch | Already established in codebase | Zero-latency notification delivery |
| Global notification context | Zustand external store | Zustand 5.x (current) | Accessible from any component without provider wrapping |
| Full page reload for preference changes | TanStack Query invalidation | Already established | Optimistic updates with automatic refetch |

**Deprecated/outdated:**
- None relevant. The codebase is on current versions of all libraries.

## Implementation Strategy

### Notification System (DASH-03) Decomposition

1. **Backend notification service** (`notificationService.ts`) -- centralized create + emit
2. **Notification CRUD routes** (`/api/notifications`) -- list, unread-count, mark-read, mark-all-read
3. **Socket.IO integration** -- add `notification:new` event to useSocket hook
4. **Retrofit existing producers** -- tokenRefresh already creates notifications; ensure patternAnalysis, stagingProcessor, and actionExecutor also create notifications via the service
5. **Frontend bell icon** -- NotificationBell in Topbar with unread badge
6. **Frontend notification dropdown** -- Popover with ScrollArea listing recent notifications
7. **Zustand notification store** -- unread count, dropdown open state

### Settings Page (PAGE-06) Decomposition

1. **Expand user preferences route** -- accept workingHoursStart, workingHoursEnd, aggressiveness in PATCH
2. **Settings API routes** -- `/api/settings` GET (read full settings), `/api/settings/export-data`, `/api/settings/delete-data`
3. **Frontend settings page** with tabbed sections:
   - Preferences tab: working hours slider, aggressiveness radio group
   - Mailboxes tab: per-mailbox connection cards (status, reconnect, disconnect, last sync)
   - Whitelist tab: per-mailbox + org whitelist management (already has backend routes)
   - Data tab: export button, delete button with confirmation dialog

### Admin Panel (PAGE-07) Decomposition

1. **Admin analytics endpoint** -- aggregate counts across all users
2. **Admin system health endpoint** -- per-mailbox webhook status, per-user token health
3. **Org-wide rule CRUD endpoints** -- existing Rule model has `scope: 'org'` field; need admin routes to create/list/update/delete org rules
4. **Frontend admin page** with tabbed sections:
   - Users tab: invite form, user table with role change and deactivate actions
   - Org Rules tab: list/create/edit org-wide rules
   - Analytics tab: aggregate stats cards
   - System Health tab: webhook subscription table, token health table

### Sidebar and Routing Updates

1. Add `adminOnly` flag to NavItem type
2. Add Admin Panel item to NAV_ITEMS (conditionally rendered)
3. Add `/admin` route to App.tsx with admin guard
4. Replace Settings ComingSoonPage with real SettingsPage

## Key Existing Infrastructure to Leverage

### Already Built (Do Not Rebuild)

| What | Where | How Phase 7 Uses It |
|------|-------|---------------------|
| Notification model with TTL | `models/Notification.ts` | Directly -- no changes needed to schema |
| Socket.IO per-user rooms | `config/socket.ts` | Add `notification:new` event emission |
| Token refresh creates notifications | `jobs/processors/tokenRefresh.ts` | Refactor to use notificationService instead of direct Notification.create() |
| Admin invite/users/role/deactivate | `routes/admin.ts` | Add analytics/health/org-rules endpoints |
| User preferences route | `routes/user.ts` | Expand to accept all preference fields |
| Mailbox whitelist routes | `routes/mailbox.ts` | Settings page links to these existing endpoints |
| Org whitelist in Redis | `services/whitelistService.ts` | Settings/admin UI for org whitelist management |
| Health endpoint | `routes/health.ts` | Admin system health extends this data |
| Error handler with ConflictError | `middleware/errorHandler.ts` | Admin invite uses 409 for duplicate emails |
| Auth store with user.role | `stores/authStore.ts` | Admin route guard checks role |

### Prior Decisions That Constrain This Phase

| Decision | From | Impact |
|----------|------|--------|
| Auth middleware at route level only | Phase 02-01 | Admin routes use `requireAuth, requireAdmin` internally |
| Separate createLoginMsalClient vs createMsalClient | Phase 02-01 | Settings reconnect flow uses createLoginMsalClient |
| ConflictError (409) for admin invite duplicates | Phase 02-02 | Admin panel invite form handles 409 response |
| Kill switch at /api/user/preferences with dedicated userRouter | Phase 04-02 | Settings page PATCH goes to same route, must not break kill switch |
| Socket.IO useRef pattern | Phase 04-02 | Adding notification listener follows same pattern |
| Socket.IO emission centralized in saveEmailEvent | Phase 04-02 | NotificationService follows same centralized emission pattern |
| Org-wide whitelist in Redis Sets | Phase 06-01 | Admin/settings whitelist UI calls existing whitelistService |
| Org-whitelist routes before /:id routes | Phase 06-03 | No changes needed to route ordering |

## Open Questions

1. **Org-wide rule target mailbox**
   - What we know: Rule model has `scope: 'org'` and `mailboxId` is required. An org-wide rule needs to apply across all mailboxes.
   - What's unclear: Should org-wide rules have a null mailboxId, or be duplicated per mailbox?
   - Recommendation: Make `mailboxId` optional on the Rule schema for org-scoped rules. The rule engine already evaluates rules per-mailbox; for org rules, query `{ scope: 'org' }` in addition to the user's mailbox-specific rules. This avoids duplication and is cleaner.

2. **Data delete scope**
   - What we know: PRD says "export or delete their data." GDPR-style.
   - What's unclear: Should data delete also remove the user account, or just the email data?
   - Recommendation: Full account deletion (user record + all associated data + session cookie cleared). The user is effectively logged out and would need a re-invite to use the system again. Show a confirmation dialog with a typed-confirmation pattern (e.g., type "DELETE" to confirm).

3. **Notification auto-cleanup beyond TTL**
   - What we know: Notification schema has a 30-day TTL index. Notifications are automatically purged after 30 days.
   - What's unclear: Should there be a manual "clear all" button, or is the 30-day TTL sufficient?
   - Recommendation: Add a "Mark all as read" button (already planned) but no manual bulk-delete. The 30-day TTL handles cleanup automatically. Keep it simple.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - All models, routes, services, and frontend components examined directly
- **MSEDB-PRD.md** - Sections 6.5.8 (Settings), 6.5.9 (Admin Panel), 6.6 (Notifications), 7.3 (API Endpoints), 7.4 (Collections)
- **REQUIREMENTS.md** - DASH-03, PAGE-06, PAGE-07 requirement definitions and traceability

### Secondary (MEDIUM confidence)
- **shadcn/ui component library** - Popover, Tabs, Dialog, Slider, RadioGroup, Progress components available via CLI
- **Socket.IO v4 documentation** - Per-room event emission, reconnection handling
- **TanStack Query v5** - Mutation + invalidation patterns

### Tertiary (LOW confidence)
- None. All findings verified against the actual codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and in use. No new dependencies needed (only new shadcn/ui components via CLI).
- Architecture: HIGH - Follows established patterns directly. Every new file follows an existing analog in the codebase.
- Pitfalls: HIGH - Identified from direct code analysis. Each pitfall references specific code paths.

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable -- no fast-moving dependencies)
