# AdminDB Design — Docker Dashboard in MSEDB

**Date:** 2026-03-10
**Status:** Approved

## Overview

Add an AdminDB dashboard to the existing MSEDB application that allows admin users to monitor and control all Docker containers running on the DGX server. Accessible at `admindb.aptask.com` via Cloudflare tunnel, protected by MSEDB's existing role-based auth (`role: 'admin'`).

---

## Architecture

- **No new containers** — AdminDB lives inside the existing MSEDB frontend and backend
- **Frontend**: New `/admin/docker` React page with a menu item visible only to `role: 'admin'` users
- **Backend**: New routes added to the existing `/api/admin/*` Express router (already protected by `requireAuth + requireAdmin` middleware)
- **Docker access**: Mount `/var/run/docker.sock` into `msedb-backend` container; use `dockerode` to communicate with Docker API
- **Cloudflare**: Add ingress rule `admindb.aptask.com → http://msedb-frontend:8080` to existing `msedb-tunnel` config

---

## UI

- Menu item **"Docker"** under the admin section, only visible when `user.role === 'admin'`
- One card per app stack, grouped by Docker compose project label (`com.docker.compose.project`)
- Each card shows:
  - Stack name
  - Container list with status badge (running / stopped / unhealthy), uptime, exposed ports
  - **Start All / Stop All** buttons for the whole stack
  - Expand to start/stop individual containers
- Ungrouped/standalone containers shown in a separate "Other" section
- Auto-refresh every 10 seconds

---

## Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/docker/stacks` | All stacks + containers with status, ports, uptime |
| POST | `/api/admin/docker/stacks/:stack/start` | Start all containers in a stack |
| POST | `/api/admin/docker/stacks/:stack/stop` | Stop all containers in a stack |
| POST | `/api/admin/docker/containers/:id/start` | Start individual container |
| POST | `/api/admin/docker/containers/:id/stop` | Stop individual container |

All routes inherit `requireAuth + requireAdmin` from the existing `adminRouter`.

---

## Auth

- Menu item hidden from `role: 'user'` accounts via frontend role check
- All `/api/admin/docker/*` routes protected by existing `requireAdmin` middleware
- No additional auth layer needed

---

## Cloudflare

- Add to `msedb-tunnel` cloudflared config:
  ```yaml
  - hostname: admindb.aptask.com
    service: http://msedb-frontend:8080
  ```

---

## docker-compose Changes

- Mount Docker socket into backend:
  ```yaml
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  ```

---

## Dependencies

- `dockerode` — Docker API client for Node.js (backend)
- `@types/dockerode` — TypeScript types
