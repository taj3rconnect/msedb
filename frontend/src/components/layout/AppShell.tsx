import { useMemo, useState, useCallback, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Topbar } from '@/components/layout/Topbar';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useKeyboardShortcuts, type Shortcut } from '@/hooks/useKeyboardShortcuts';
import { useUiStore } from '@/stores/uiStore';
import { ROUTE_PATHS } from '@/lib/constants';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256; // 16rem
const STORAGE_KEY = 'sidebar-width';

function GlobalShortcuts() {
  const navigate = useNavigate();
  const toggleShortcutsHelp = useUiStore((s) => s.toggleShortcutsHelp);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      // Navigation chords: G then <key>
      { key: 'i', chord: 'g', action: () => navigate(ROUTE_PATHS.inbox) },
      { key: 'd', chord: 'g', action: () => navigate(ROUTE_PATHS.dashboard) },
      { key: 'a', chord: 'g', action: () => navigate(ROUTE_PATHS.activity) },
      { key: 'p', chord: 'g', action: () => navigate(ROUTE_PATHS.patterns) },
      { key: 'r', chord: 'g', action: () => navigate(ROUTE_PATHS.rules) },
      { key: 's', chord: 'g', action: () => navigate(ROUTE_PATHS.settings) },
      { key: 't', chord: 'g', action: () => navigate(ROUTE_PATHS.staging) },
      { key: 'u', chord: 'g', action: () => navigate(ROUTE_PATHS.audit) },
      // Help
      { key: '?', action: () => toggleShortcutsHelp() },
    ],
    [navigate, toggleShortcutsHelp],
  );

  useKeyboardShortcuts(shortcuts);
  return null;
}

/** Draggable resize handle for the sidebar. */
function SidebarResizeHandle({ onResize }: { onResize: (width: number) => void }) {
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
      onResize(width);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="hidden md:flex absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize items-center justify-center hover:bg-primary/10 active:bg-primary/20 transition-colors"
      style={{ left: 'var(--sidebar-width)' }}
    >
      <div className="h-8 w-0.5 rounded-full bg-border" />
    </div>
  );
}

/**
 * Main application layout shell.
 *
 * Wraps all authenticated pages with:
 * - SidebarProvider for sidebar state management
 * - AppSidebar on the left
 * - Topbar at the top of the content area
 * - Main content area rendering child routes via Outlet
 * - Global keyboard shortcuts + help dialog
 */
export function AppShell({ children }: { children?: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : SIDEBAR_DEFAULT;
  });

  const handleResize = useCallback((width: number) => {
    setSidebarWidth(width);
    localStorage.setItem(STORAGE_KEY, String(width));
  }, []);

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <AppSidebar />
      <SidebarResizeHandle onResize={handleResize} />
      <SidebarInset>
        <Topbar />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children ?? <Outlet />}
        </main>
      </SidebarInset>
      <GlobalShortcuts />
      <KeyboardShortcutsDialog />
    </SidebarProvider>
  );
}
