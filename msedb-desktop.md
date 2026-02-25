# MSEDB Electron Desktop App

## Context
The MSEDB web app is mature (v1.15) with inbox, rules, patterns, staging, dashboard, and AI summary features. The goal is to create a Windows desktop app using Electron.js as the first step toward replacing Outlook as the team's primary email client. Features will be added incrementally across phases.

## Architecture Decision: Phase 1 = "Smart Browser Window"
The Electron app loads the existing frontend from the running nginx server (`https://msedb.aptask.com` or `https://172.16.219.222:3010`). **Zero frontend/backend code changes needed.** Auth, cookies, Socket.IO, and API calls all work identically because the BrowserWindow is Chromium.

This is the right approach because:
- No CORS changes needed (same origin)
- httpOnly `msedb_session` cookie works natively
- Azure AD OAuth redirect flow works (just in-window navigation)
- Socket.IO WebSocket works (same origin + cookies)
- Fastest path to a working desktop app

---

## Phase 1: Working Desktop App

### New files (all in `desktop/`)

```
desktop/
  package.json
  tsconfig.json
  electron-builder.yml
  .gitignore
  src/
    main.ts              # Electron main process
    preload.ts           # Security bridge (minimal for Phase 1)
  assets/
    icon.ico             # Windows app icon (256x256)
    icon.png             # Source icon
```

### `desktop/package.json`
```json
{
  "name": "msedb-desktop",
  "version": "1.15.1",
  "description": "MSEDB - Microsoft Email Dashboard",
  "main": "dist/main.js",
  "private": true,
  "scripts": {
    "dev": "tsc && electron dist/main.js",
    "build": "tsc",
    "pack": "tsc && electron-builder --dir",
    "dist:win": "tsc && electron-builder --win"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.7.0"
  }
}
```

### `desktop/src/main.ts` — Main process
Key behaviors:
- **Window**: 1400x900, min 800x600, auto-hide menu bar, Windows icon
- **Self-signed certs**: `setCertificateVerifyProc` accepts all certs (Phase 1)
- **OAuth navigation**: `will-navigate` allows Azure AD domains + backend URL, opens everything else in system browser
- **External links**: `setWindowOpenHandler` routes non-auth URLs to `shell.openExternal()`
- **URL**: Loads `MSEDB_URL` env var, defaults to `https://msedb.aptask.com`
- **Version**: Reads from shared `version.json` at repo root

### `desktop/src/preload.ts` — Minimal bridge
Exposes `window.electronAPI.isElectron` and `window.electronAPI.platform` via `contextBridge`. Phase 2+ adds notification IPC, file dialogs, etc.

### `desktop/electron-builder.yml` — Windows packaging
- NSIS installer (not one-click, allows custom install dir)
- Target: win x64
- App ID: `com.aptask.msedb`
- Product name: MSEDB

### No backend/frontend changes needed
- CORS: same origin (loads from `https://msedb.aptask.com`) — no change
- Cookies: `sameSite: 'lax'` + `secure` based on NODE_ENV — works in Electron
- Socket.IO: same origin with credentials — works in Electron
- API client: relative URLs proxied by nginx — works in Electron

### Dev workflow
```bash
# Terminal 1: Docker stack (already running)
docker compose up -d

# Terminal 2: Electron dev
cd desktop && npm install && npm run dev

# Against local server:
MSEDB_URL=https://172.16.219.222:3010 npm run dev
```

### Build & distribute
```bash
cd desktop
npm run dist:win    # Produces release/MSEDB-Setup-1.15.1.exe
```

---

## Phase 2 (Future): Native Features
- **System tray** — minimize to tray, show unread badge via Socket.IO IPC
- **Native notifications** — `Notification` API in main process, triggered by `notification:new` Socket.IO events forwarded via preload IPC
- **Auto-update** — `electron-updater` with generic provider, host update files at `/updates/` on the MSEDB server
- **Bundled frontend** — Ship `frontend/dist/` inside Electron, serve via `protocol.handle`, configure `apiFetch` base URL via env. Enables offline shell.

## Phase 3 (Future): Email Client Features
- **Compose email** — Rich text editor (TipTap), new `POST /api/mail/send` endpoint
- **Contacts** — Graph API `People`/`Contacts` endpoints, autocomplete in compose
- **Calendar** — Add `Calendars.Read` scope, new `/api/calendar` endpoint + `CalendarPage.tsx`
- **Drag-and-drop attachments** — Electron file dialog integration via preload IPC

## Phase 4 (Future): Offline & Local Cache
- **SQLite** — `better-sqlite3` in main process for local email/contact cache
- **Offline queue** — Queue mutations (mark read, delete, compose) for replay on reconnect
- **Service worker** — Cache API responses for offline access

---

## Verification (Phase 1)
1. `cd desktop && npm install && npm run dev` — Electron window opens
2. Azure AD login works (redirect stays in window, cookie is set)
3. Inbox loads with real-time updates (Socket.IO connected)
4. Reply/forward works from the app
5. External links open in system browser
6. `npm run dist:win` produces a working `.exe` installer
7. Install and run the installer on a Windows machine
