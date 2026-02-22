import { LogOut } from 'lucide-react';
import { useLocation, useParams, useNavigate } from 'react-router';
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
import { MailboxSelector } from '@/components/shared/MailboxSelector';
import { KillSwitch } from '@/components/layout/KillSwitch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
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

  const isInboxPage = location.pathname.startsWith('/inbox');
  const connectedMailboxes = mailboxes.filter((m) => m.isConnected);
  const activeMailboxId = mailboxId || (connectedMailboxes.length > 0 ? connectedMailboxes[0].id : undefined);
  const inboxFolder = useUiStore((s) => s.inboxFolder);
  const setInboxFolder = useUiStore((s) => s.setInboxFolder);

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : user?.email?.charAt(0).toUpperCase() ?? '?';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      {/* Inbox label + mailbox tags — shown only on inbox pages */}
      {isInboxPage && connectedMailboxes.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {connectedMailboxes.map((mb) => (
              <Badge
                key={mb.id}
                variant={mb.id === activeMailboxId ? 'default' : 'outline'}
                className="cursor-pointer text-xs px-2.5 py-0.5"
                onClick={() => navigate(`/inbox/${mb.id}`)}
              >
                {mb.email}
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
          </div>
        </div>
      )}

      <div className="flex flex-1 items-center justify-end gap-3">
        <MailboxSelector />
        <KillSwitch />
        <NotificationBell />

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
    </header>
  );
}
