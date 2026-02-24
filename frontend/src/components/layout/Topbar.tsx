import { useState } from 'react';
import { HelpCircle, LogOut, SquarePen } from 'lucide-react';
import { useLocation, useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { KillSwitch } from '@/components/layout/KillSwitch';
import { ComposeEmailDialog } from '@/components/inbox/ComposeEmailDialog';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { fetchMailboxCounts } from '@/api/events';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useAuth } from '@/hooks/useAuth';

/**
 * Top navigation bar displayed on every authenticated page.
 *
 * Left: sidebar trigger (hamburger) for mobile.
 * Right: mailbox selector, kill switch toggle, user avatar dropdown.
 */
export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const { logout } = useAuth();
  const location = useLocation();
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const navigate = useNavigate();

  const [composeOpen, setComposeOpen] = useState(false);
  const isInboxPage = location.pathname.startsWith('/inbox');
  const connectedMailboxes = mailboxes.filter((m) => m.isConnected);
  const activeMailboxId = mailboxId || null;
  const inboxFolder = useUiStore((s) => s.inboxFolder);
  const setInboxFolder = useUiStore((s) => s.setInboxFolder);

  const { data: countsData } = useQuery({
    queryKey: ['mailbox-counts'],
    queryFn: fetchMailboxCounts,
    enabled: isInboxPage && connectedMailboxes.length > 0,
    refetchInterval: 60000,
  });
  const mailboxCounts = countsData?.counts ?? {};

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : user?.email?.charAt(0).toUpperCase() ?? '?';

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setComposeOpen(true)}
          >
            <SquarePen className="h-4 w-4" />
            <span className="hidden sm:inline">New Email</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Compose new email</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-4" />

      {/* Inbox label + mailbox tags — shown only on inbox pages */}
      {isInboxPage && connectedMailboxes.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {connectedMailboxes.length >= 2 && (
              <Badge
                variant={activeMailboxId === null ? 'default' : 'outline'}
                className="cursor-pointer text-xs px-2.5 py-1 h-auto"
                onClick={() => navigate('/inbox')}
              >
                <div className="flex flex-col items-start">
                  <span>Unified MB</span>
                  <span className="text-[10px] opacity-70 tabular-nums">
                    {Object.values(mailboxCounts).reduce((a, b) => a + b, 0).toLocaleString()}
                  </span>
                </div>
              </Badge>
            )}
            {connectedMailboxes.map((mb) => (
              <Badge
                key={mb.id}
                variant={mb.id === activeMailboxId ? 'default' : 'outline'}
                className="cursor-pointer text-xs px-2.5 py-1 h-auto"
                onClick={() => navigate(`/inbox/${mb.id}`)}
              >
                <div className="flex flex-col items-start">
                  <span>{mb.email}</span>
                  <span className="text-[10px] opacity-70 tabular-nums">
                    {(mailboxCounts[mb.id] ?? 0).toLocaleString()}
                  </span>
                </div>
              </Badge>
            ))}
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1">
            <Badge
              variant={inboxFolder === 'inbox' ? 'default' : 'outline'}
              className="cursor-pointer text-xs px-2.5 py-0.5"
              onClick={() => setInboxFolder('inbox')}
            >
              Inbox
            </Badge>
            <Badge
              variant={inboxFolder === 'deleted' ? 'default' : 'outline'}
              className="cursor-pointer text-xs px-2.5 py-0.5"
              onClick={() => setInboxFolder('deleted')}
            >
              Deleted Items
            </Badge>
            {inboxFolder !== 'inbox' && inboxFolder !== 'deleted' && (
              <Badge
                variant="default"
                className="text-xs px-2.5 py-0.5"
              >
                {inboxFolder}
              </Badge>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 items-center justify-end gap-3">
        <KillSwitch />
        <NotificationBell />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => useUiStore.getState().toggleShortcutsHelp()}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Keyboard shortcuts"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="cursor-pointer rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Avatar size="sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user?.displayName ?? 'User'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ComposeEmailDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </header>
  );
}
