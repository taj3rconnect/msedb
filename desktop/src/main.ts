import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const MSEDB_URL = process.env.MSEDB_URL || 'https://msedb.aptask.com';

const ALLOWED_NAVIGATE_HOSTS = [
  new URL(MSEDB_URL).hostname,
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'aadcdn.msftauth.net',
  'aadcdn.msauth.net',
];

function readVersion(): string {
  try {
    const versionPath = path.join(__dirname, '..', '..', 'version.json');
    const data = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
    return data.version || '1.15';
  } catch {
    return '1.15';
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: `MSEDB ${readVersion()}`,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Accept self-signed certificates (Phase 1 — internal server)
  win.webContents.session.setCertificateVerifyProc((_request, callback) => {
    callback(0); // 0 = accept
  });

  // Navigation guard: allow MSEDB + Azure AD, open everything else externally
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const { hostname } = new URL(url);
      const allowed = ALLOWED_NAVIGATE_HOSTS.some(
        (h) => hostname === h || hostname.endsWith('.' + h)
      );
      if (!allowed) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Handle window.open() / target="_blank" links
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { hostname } = new URL(url);
      const isAuth = ALLOWED_NAVIGATE_HOSTS.some(
        (h) => hostname === h || hostname.endsWith('.' + h)
      );
      if (isAuth) {
        // Let Azure AD popups open in the main window instead
        win.loadURL(url);
      } else {
        shell.openExternal(url);
      }
    } catch {
      // Invalid URL — ignore
    }
    return { action: 'deny' };
  });

  // Set window title on page load
  win.webContents.on('did-finish-load', () => {
    const version = readVersion();
    const pageTitle = win.webContents.getTitle();
    win.setTitle(pageTitle ? `${pageTitle} — MSEDB ${version}` : `MSEDB ${version}`);
  });

  win.loadURL(MSEDB_URL);

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
