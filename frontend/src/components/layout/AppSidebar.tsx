import { NavLink, useNavigate } from 'react-router';
import { Mail, Database } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NAV_ITEMS, ROUTE_PATHS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useStagingCount } from '@/hooks/useStaging';
import { useHealth } from '@/hooks/useHealth';
import { useMailboxes } from '@/hooks/useMailboxes';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_DATE__: string;

/**
 * Application sidebar with logo and navigation links.
 *
 * Uses shadcn Sidebar component with react-router NavLink for active state.
 * Collapsible on mobile via SidebarTrigger in the Topbar.
 */
export function AppSidebar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: countData } = useStagingCount();
  const stagingCount = countData?.count ?? 0;
  const { isHealthy, mongoStatus, mongoHost } = useHealth();
  const { mailboxes } = useMailboxes();

  // Most recent sync across all mailboxes
  const lastSyncAt = mailboxes
    .map((m) => m.lastSyncAt)
    .filter(Boolean)
    .sort()
    .pop();

  const formatSyncTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user?.role === 'admin',
  );

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <Mail className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">MSEDB</span>
          {__APP_VERSION__ && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {__APP_VERSION__} {__APP_BUILD_DATE__}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Database
                className={`h-4 w-4 shrink-0 ${
                  isHealthy ? 'text-green-500' : 'text-red-500'
                }`}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p>MongoDB: {mongoStatus === 'connected' ? mongoHost : 'disconnected'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        {lastSyncAt && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Last synced: {formatSyncTime(lastSyncAt)}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        isActive ? 'text-primary font-semibold' : ''
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {item.path === ROUTE_PATHS.staging && stagingCount > 0 && (
                        <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0 min-w-5 h-5 flex items-center justify-center">
                          {stagingCount}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
