import { Outlet } from 'react-router';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Topbar } from '@/components/layout/Topbar';

/**
 * Main application layout shell.
 *
 * Wraps all authenticated pages with:
 * - SidebarProvider for sidebar state management
 * - AppSidebar on the left
 * - Topbar at the top of the content area
 * - Main content area rendering child routes via Outlet
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
    </SidebarProvider>
  );
}
