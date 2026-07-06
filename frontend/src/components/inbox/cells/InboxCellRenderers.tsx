import {
  Ban,
  CheckCircle,
  Mail,
  MailCheck,
  MailOpen,
  MoreHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { EventItem } from '@/api/events';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { TrackingTooltip } from '../TrackingTooltip';
import { formatDateTime, highlightText } from '@/lib/formatters';

export interface TrackingMatch {
  trackingId: string;
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

// --- Context type for cell renderers ---
export interface GridContext {
  onAction: (event: EventItem) => void;
  onClearRules: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onJustDelete: (event: EventItem) => void;
  onMarkRead: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onUndelete?: (event: EventItem) => void;
  onToggleSelect: (id: string) => void;
  selectedIds: Set<string>;
  folderFilter: string;
  searchQuery: string;
  largeIcons: boolean;
  trackingMap?: Record<string, TrackingMatch>;
}

// --- Custom checkbox cell renderer (fully parent-controlled) ---
export function CheckboxCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;
  return (
    <div className="h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        checked={ctx.selectedIds.has(event._id)}
        onCheckedChange={() => ctx.onToggleSelect(event._id)}
      />
    </div>
  );
}

// --- Cell Renderers ---

export function RowActionsCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;
  const iconSize = ctx.largeIcons ? 20 : 16;
  const btnPad = ctx.largeIcons ? 8 : 6;

  return (
    <div className="h-full flex items-center gap-0.5">
      {ctx.folderFilter === 'deleted' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded text-green-600 hover:!text-green-500 transition-all"
              style={{ padding: btnPad }}
              onClick={(e) => { e.stopPropagation(); ctx.onUndelete?.(event); }}
            >
              <Undo2 style={{ width: iconSize, height: iconSize }} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Undelete & remove rules for this sender</TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded text-green-600 hover:!text-green-500 transition-all"
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); ctx.onClearRules(event); }}
                disabled={!event.sender?.email}
              >
                <CheckCircle style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Remove all rules for this sender</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded text-muted-foreground hover:!text-destructive transition-all"
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); ctx.onJustDelete(event); }}
              >
                <Trash2 style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete this email</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded text-muted-foreground hover:!text-destructive transition-all"
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); ctx.onQuickDelete(event); }}
                disabled={!event.sender?.email}
              >
                <Ban style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Always delete from this sender</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`shrink-0 rounded transition-all ${event.isRead ? 'text-muted-foreground/30 cursor-default' : 'text-muted-foreground hover:!text-green-500'}`}
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); if (!event.isRead) ctx.onMarkRead(event); }}
                disabled={event.isRead}
              >
                <MailCheck style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{event.isRead ? 'Already read' : 'Mark as read'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded text-muted-foreground hover:!text-blue-500 transition-all"
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); ctx.onQuickMarkRead(event); }}
                disabled={!event.sender?.email}
              >
                <MailOpen style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Always mark read from this sender</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded text-muted-foreground hover:!text-foreground transition-all"
                style={{ padding: btnPad }}
                onClick={(e) => { e.stopPropagation(); ctx.onAction(event); }}
              >
                <MoreHorizontal style={{ width: iconSize, height: iconSize }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Create custom rule</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

export function SenderCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;

  return (
    <div className="min-w-0 w-full h-full flex items-center overflow-hidden">
      <div className="min-w-0 w-full flex flex-col justify-center overflow-hidden">
        <div
          className="font-medium truncate text-left leading-tight"
          dangerouslySetInnerHTML={{
            __html: highlightText(event.sender?.name || event.sender?.email || '', ctx.searchQuery),
          }}
        />
        {event.sender?.name && event.sender?.email && (
          <div
            className="text-xs text-muted-foreground truncate text-left leading-tight"
            dangerouslySetInnerHTML={{
              __html: highlightText(event.sender.email, ctx.searchQuery),
            }}
          />
        )}
      </div>
    </div>
  );
}

export function SubjectCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;
  return (
    <span
      className="truncate block text-left"
      dangerouslySetInnerHTML={{
        __html: highlightText(event.subject || '(no subject)', ctx.searchQuery),
      }}
    />
  );
}

export function TimeCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
      {formatDateTime(props.value!)}
    </span>
  );
}

export function StatusCellRenderer(props: CustomCellRendererProps<EventItem, boolean, GridContext>) {
  const isRead = props.value;
  return isRead ? (
    <span className="text-xs text-muted-foreground">Read</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
      <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
      Unread
    </span>
  );
}

export function ImportanceCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const v = props.value;
  if (v === 'high') {
    return <span className="text-xs font-medium text-red-600 dark:text-red-400">High</span>;
  }
  if (v === 'low') {
    return <span className="text-xs text-muted-foreground">Low</span>;
  }
  return <span className="text-xs text-muted-foreground">Normal</span>;
}

export function FolderCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const val = props.value;
  return (
    <span className="text-sm text-muted-foreground truncate block">
      {val || '—'}
    </span>
  );
}

export function MailboxCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const email = props.value || '';
  const truncated = email.length > 20 ? email.slice(0, 20) + '...' : email;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-sm text-muted-foreground truncate block max-w-[160px]">
          {truncated}
        </span>
      </TooltipTrigger>
      <TooltipContent>{email}</TooltipContent>
    </Tooltip>
  );
}

export function ActionsCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => { e.stopPropagation(); ctx.onAction(event); }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Create rule</TooltipContent>
    </Tooltip>
  );
}

export function OpensCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
  const event = props.data!;
  const ctx = props.context!;
  const trackingMap = ctx.trackingMap;
  if (!trackingMap) return null;

  const key = `${event.mailboxId}:${event.subject || ''}:${event.timestamp}`;
  const match = trackingMap[key];

  if (!match) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Mail className="h-4 w-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>No tracking data</TooltipContent>
      </Tooltip>
    );
  }

  if (match.openCount === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span className="text-xs">0</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>Not opened yet</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 cursor-pointer">
          <MailOpen className="h-4 w-4" />
          <span className="text-xs font-medium">{match.openCount}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="p-0">
        <TrackingTooltip trackingId={match.trackingId} />
      </TooltipContent>
    </Tooltip>
  );
}
