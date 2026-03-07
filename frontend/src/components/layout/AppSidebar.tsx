import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Mail, Database, FolderOpen, Inbox, Send, Trash2, Archive,
  FileWarning, Pencil, Folder, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NAV_ITEMS, ROUTE_PATHS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useHealth } from '@/hooks/useHealth';
import { useFolders } from '@/hooks/useFolders';
import { fetchChildFolders, type MailFolder } from '@/api/mailboxes';
import { formatDateTime } from '@/lib/formatters';

declare const __APP_VERSION__: string;
declare const __APP_BUILD_DATE__: string;

/** Map well-known folder display names to icons. */
const FOLDER_ICON_MAP: Record<string, typeof Folder> = {
  'Inbox': Inbox,
  'Sent Items': Send,
  'Deleted Items': Trash2,
  'Drafts': Pencil,
  'Junk Email': FileWarning,
  'Archive': Archive,
};

/** Map folder display names to the filter value the backend expects. */
const FOLDER_FILTER_MAP: Record<string, string> = {
  'Inbox': 'inbox',
  'Deleted Items': 'deleted',
  'Sent Items': 'sent',
  'Drafts': 'drafts',
  'Junk Email': 'junk',
  'Archive': 'archive',
};

/** Priority order for well-known folders (lower = higher in list). */
const FOLDER_SORT_ORDER: Record<string, number> = {
  'Inbox': 0,
  'Deleted Items': 1,
  'Sent Items': 2,
  'Drafts': 3,
  'Archive': 4,
  'Junk Email': 5,
};

function sortFolders(folders: MailFolder[]): MailFolder[] {
  return [...folders].sort((a, b) => {
    const pa = FOLDER_SORT_ORDER[a.displayName] ?? 99;
    const pb = FOLDER_SORT_ORDER[b.displayName] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Expandable folder item with lazy-loaded children. */
function FolderItem({
  folder,
  mailboxId,
  inboxFolder,
  onFolderClick,
  depth = 0,
}: {
  folder: MailFolder;
  mailboxId: string;
  inboxFolder: string;
  onFolderClick: (folder: MailFolder) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // Hide folders with zero messages and no children
  if (folder.totalItemCount === 0 && folder.childFolderCount === 0) return null;

  const Icon = FOLDER_ICON_MAP[folder.displayName] || Folder;
  const filterValue = FOLDER_FILTER_MAP[folder.displayName] || folder.displayName;
  const active = inboxFolder === filterValue;
  const hasChildren = folder.childFolderCount > 0;

  // Lazy-load children only when expanded
  const { data: childData, isLoading: childrenLoading } = useQuery({
    queryKey: ['child-folders', mailboxId, folder.id],
    queryFn: () => fetchChildFolders(mailboxId, folder.id),
    enabled: expanded && hasChildren,
    staleTime: 5 * 60 * 1000,
  });

  const children = childData?.folders ?? [];

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        size="sm"
        isActive={active}
        onClick={() => onFolderClick(folder)}
        className="cursor-pointer"
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="shrink-0 p-0 border-0 bg-transparent cursor-pointer"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">{folder.displayName}</span>
        {folder.totalItemCount > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            ({folder.totalItemCount.toLocaleString()})
          </span>
        )}
      </SidebarMenuSubButton>

      {/* Child folders */}
      {expanded && hasChildren && (
        <SidebarMenuSub>
          {childrenLoading ? (
            <div className="flex items-center justify-center py-1">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          ) : (
            children.map((child) => (
              <FolderItem
                key={child.id}
                folder={child}
                mailboxId={mailboxId}
                inboxFolder={inboxFolder}
                onFolderClick={onFolderClick}
                depth={depth + 1}
              />
            ))
          )}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

/**
 * Application sidebar with logo and navigation links.
 *
 * Uses shadcn Sidebar component with react-router NavLink for active state.
 * Collapsible on mobile via SidebarTrigger in the Topbar.
 */
export function AppSidebar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { isHealthy, mongoStatus, mongoHost } = useHealth();
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connectedMailboxes = mailboxes.filter((m) => m.isConnected);

  // Folder browser state
  const foldersExpanded = useUiStore((s) => s.foldersExpanded);
  const toggleFolders = useUiStore((s) => s.toggleFolders);
  const selectedFolderMailboxId = useUiStore((s) => s.selectedFolderMailboxId);
  const setSelectedFolderMailboxId = useUiStore((s) => s.setSelectedFolderMailboxId);
  const inboxFolder = useUiStore((s) => s.inboxFolder);
  const setInboxFolder = useUiStore((s) => s.setInboxFolder);
  const requestFolderSync = useUiStore((s) => s.requestFolderSync);

  // Auto-select first mailbox if none selected
  useEffect(() => {
    if (!selectedFolderMailboxId && connectedMailboxes.length > 0) {
      setSelectedFolderMailboxId(connectedMailboxes[0].id);
    }
  }, [selectedFolderMailboxId, connectedMailboxes, setSelectedFolderMailboxId]);

  // Fetch folders for selected mailbox (only when expanded)
  const { folders, isLoading: foldersLoading } = useFolders(
    foldersExpanded ? (selectedFolderMailboxId ?? undefined) : undefined,
  );

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
    return formatDateTime(iso);
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user?.role === 'admin',
  );

  const handleFolderClick = (folder: MailFolder) => {
    const filterValue = FOLDER_FILTER_MAP[folder.displayName] || folder.displayName;
    setInboxFolder(filterValue, folder.id);
    const mbId = selectedFolderMailboxId;

    // "Inbox" folder → always unified mode (/inbox) to show all mailboxes
    // Other folders → single mailbox mode since they're mailbox-specific
    if (filterValue === 'inbox') {
      setInboxFolder('inbox', null); // clear activeFolderId for unified inbox
      navigate('/inbox');
      return;
    } else if (mbId) {
      navigate(`/inbox/${mbId}`);
      // Signal InboxPage to start syncing this folder with progress UI
      requestFolderSync();
    } else {
      navigate('/inbox');
    }
  };

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
                      onClick={() => {
                        // Reset to unified inbox when clicking nav Inbox link
                        if (item.path === ROUTE_PATHS.inbox) {
                          setInboxFolder('inbox', null);
                        }
                      }}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Folders group */}
        {connectedMailboxes.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <SidebarGroupAction onClick={toggleFolders} title={foldersExpanded ? 'Collapse folders' : 'Expand folders'}>
              {foldersExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
            </SidebarGroupAction>
            {foldersExpanded && (
              <SidebarGroupContent>
                {/* Mailbox selector — only if multiple mailboxes */}
                {connectedMailboxes.length > 1 && (
                  <div className="px-3 pb-2">
                    <Select
                      value={selectedFolderMailboxId ?? ''}
                      onValueChange={(v) => setSelectedFolderMailboxId(v)}
                    >
                      <SelectTrigger size="sm" className="w-full text-xs">
                        <SelectValue placeholder="Select mailbox" />
                      </SelectTrigger>
                      <SelectContent>
                        {connectedMailboxes.map((mb) => (
                          <SelectItem key={mb.id} value={mb.id}>
                            {mb.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Folder tree */}
                <SidebarMenu>
                  <SidebarMenuItem>
                    {foldersLoading ? (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <SidebarMenuSub>
                        {sortFolders(folders).map((folder) => (
                          <FolderItem
                            key={folder.id}
                            folder={folder}
                            mailboxId={selectedFolderMailboxId!}
                            inboxFolder={inboxFolder}
                            onFolderClick={handleFolderClick}
                          />
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
