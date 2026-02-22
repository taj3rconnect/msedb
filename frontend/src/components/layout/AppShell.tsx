import { useMemo } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Topbar } from '@/components/layout/Topbar';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useKeyboardShortcuts, type Shortcut } from '@/hooks/useKeyboardShortcuts';
import { useUiStore } from '@/stores/uiStore';
import { ROUTE_PATHS } from '@/lib/constants';

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
  return (
    <SidebarProvider>
      <AppSidebar />
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
