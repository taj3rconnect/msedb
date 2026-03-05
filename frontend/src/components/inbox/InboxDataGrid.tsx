import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridReadyEvent,
  type SelectionChangedEvent,
  type ColumnState,
  type StateUpdatedEvent,
  type GridApi,
  type RowClassRules,
  type GetRowIdParams,
} from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import {
  Ban,
  CheckCircle,
  Mail,
  MailCheck,
  MailOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { EventItem } from '@/api/events';
import { TrackingTooltip } from './TrackingTooltip';
import { useUiStore } from '@/stores/uiStore';

// Register all community modules once
ModuleRegistry.registerModules([AllCommunityModule]);

// --- AG Grid Theme ---
const COLUMN_STATE_KEY_PREFIX = 'inbox-ag-grid-column-state-v2';

// Light theme customized for the app
const gridThemeLight = themeQuartz.withParams({
  fontSize: 13,
  headerFontSize: 12,
  rowHeight: 42,
  headerHeight: 38,
  borderRadius: 6,
  wrapperBorderRadius: 6,
  spacing: 4,
  rowBorder: { color: 'hsl(var(--border))' },
  borderColor: 'hsl(var(--border))',
  headerBackgroundColor: 'hsl(var(--muted))',
  headerTextColor: 'hsl(var(--muted-foreground))',
  backgroundColor: 'hsl(var(--background))',
  foregroundColor: 'hsl(var(--foreground))',
  selectedRowBackgroundColor: 'hsl(var(--muted))',
  rowHoverColor: 'color-mix(in srgb, hsl(var(--muted)) 50%, transparent)',
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: 'hsl(var(--primary))',
});

// Dark theme
const gridThemeDark = themeQuartz.withParams({
  fontSize: 13,
  headerFontSize: 12,
  rowHeight: 42,
  headerHeight: 38,
  borderRadius: 6,
  wrapperBorderRadius: 6,
  spacing: 4,
  rowBorder: { color: 'hsl(var(--border))' },
  borderColor: 'hsl(var(--border))',
  headerBackgroundColor: 'hsl(var(--muted))',
  headerTextColor: 'hsl(var(--muted-foreground))',
  backgroundColor: 'hsl(var(--background))',
  foregroundColor: 'hsl(var(--foreground))',
  selectedRowBackgroundColor: 'hsl(var(--muted))',
  rowHoverColor: 'color-mix(in srgb, hsl(var(--muted)) 50%, transparent)',
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: 'hsl(var(--primary))',
});

// --- Helpers ---
function highlightText(text: string, query: string): string {
  if (!query || !text) return text;
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(pattern, '<mark class="bg-yellow-200 dark:bg-yellow-500/30 rounded-sm px-0.5">$1</mark>');
}

interface TrackingMatch {
  trackingId: string;
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

// --- Context type for cell renderers ---
interface GridContext {
  onAction: (event: EventItem) => void;
  onClearRules: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onJustDelete: (event: EventItem) => void;
  onMarkRead: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onUndelete?: (event: EventItem) => void;
  folderFilter: string;
  searchQuery: string;
  largeIcons: boolean;
  trackingMap?: Record<string, TrackingMatch>;
}

// --- Cell Renderers ---

function RowActionsCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
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

function SenderCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
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

function SubjectCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
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

function TimeCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const d = new Date(props.value!);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  let hh = d.getHours();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
      {mm}-{dd}-{yy} {hh}:{min}:{ss} {ampm}
    </span>
  );
}

function StatusCellRenderer(props: CustomCellRendererProps<EventItem, boolean, GridContext>) {
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

function ImportanceCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const v = props.value;
  if (v === 'high') {
    return <span className="text-xs font-medium text-red-600 dark:text-red-400">High</span>;
  }
  if (v === 'low') {
    return <span className="text-xs text-muted-foreground">Low</span>;
  }
  return <span className="text-xs text-muted-foreground">Normal</span>;
}

function FolderCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
  const val = props.value;
  return (
    <span className="text-sm text-muted-foreground truncate block">
      {val || '\u2014'}
    </span>
  );
}

function MailboxCellRenderer(props: CustomCellRendererProps<EventItem, string, GridContext>) {
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

function ActionsCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
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

function OpensCellRenderer(props: CustomCellRendererProps<EventItem, unknown, GridContext>) {
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

// --- Props ---
interface InboxDataGridProps {
  data: EventItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  someSelected: boolean;
  onAction: (event: EventItem) => void;
  onClearRules: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onJustDelete: (event: EventItem) => void;
  onMarkRead: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onUndelete?: (event: EventItem) => void;
  onRowClick?: (event: EventItem) => void;
  activeEventId?: string;
  focusedEventId?: string;
  folderFilter?: string;
  showFilters?: boolean;
  onToggleFilters?: (show: boolean) => void;
  toolbarSlot?: React.ReactNode;
  hideToolbar?: boolean;
  renderToolbar?: (toolbarNode: React.ReactNode) => void;
  searchQuery?: string;
  isUnifiedMode?: boolean;
  mailboxEmailMap?: Map<string, string>;
  trackingMap?: Record<string, TrackingMatch>;
}

// --- Main Component ---
export function InboxDataGrid({
  data,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  someSelected,
  onAction,
  onClearRules,
  onQuickDelete,
  onJustDelete,
  onMarkRead,
  onQuickMarkRead,
  onUndelete,
  onRowClick,
  activeEventId,
  focusedEventId,
  folderFilter = 'inbox',
  showFilters: showFiltersProp,
  onToggleFilters,
  toolbarSlot,
  hideToolbar,
  searchQuery = '',
  isUnifiedMode = false,
  mailboxEmailMap,
  trackingMap,
}: InboxDataGridProps) {
  const largeIcons = useUiStore((s) => s.largeIcons);
  const toggleIconSize = useUiStore((s) => s.toggleIconSize);
  const gridRef = useRef<AgGridReact<EventItem>>(null);
  const apiRef = useRef<GridApi<EventItem> | null>(null);
  const [showFiltersInternal, setShowFiltersInternal] = useState(false);
  const showFilters = showFiltersProp ?? showFiltersInternal;
  const setShowFilters = onToggleFilters ?? setShowFiltersInternal;
  const suppressSelectionSync = useRef(false);

  // Detect dark mode
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const theme = isDark ? gridThemeDark : gridThemeLight;

  // Grid context passed to cell renderers
  const gridContext = useMemo<GridContext>(
    () => ({
      onAction,
      onClearRules,
      onQuickDelete,
      onJustDelete,
      onMarkRead,
      onQuickMarkRead,
      onUndelete,
      folderFilter,
      searchQuery,
      largeIcons,
      trackingMap,
    }),
    [onAction, onClearRules, onQuickDelete, onJustDelete, onMarkRead, onQuickMarkRead, onUndelete, folderFilter, searchQuery, largeIcons, trackingMap],
  );

  // Column definitions
  const columnDefs = useMemo<ColDef<EventItem>[]>(() => {
    const isDeleted = folderFilter === 'deleted';
    // Fixed width to guarantee all icons always fit: 5 icons (normal) or 1 (deleted)
    // button size = icon + padding×2 | gap-0.5 = 2px between buttons
    const actionsWidth = isDeleted
      ? (largeIcons ? 44 : 36)       // 1 icon: 36px (small) / 44px (large)
      : (largeIcons ? 230 : 182);    // 6 icons: 6×28+10=178→182 | 6×36+10=226→230

    const cols: ColDef<EventItem>[] = [
      // Row actions — fixed-width left column, icons appear on row hover
      {
        colId: 'rowActions',
        headerName: '',
        cellRenderer: RowActionsCellRenderer,
        width: actionsWidth,
        minWidth: actionsWidth,
        maxWidth: actionsWidth,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        pinned: 'left' as const,
        suppressHeaderMenuButton: true,
        cellClass: 'row-actions-cell',
      },
      // Sender — left-aligned
      // IMPORTANT: The valueGetter must return a value that is unique per row
      // (not just per sender). AG Grid uses props.value to decide whether to
      // re-render a recycled cell renderer component. If two rows from the same
      // sender share the same props.value, React skips the re-render and
      // props.data stays stale from the previously-rendered row — causing the
      // sender name and email address to appear offset by one row.
      // Including the row _id makes props.value unique per row, guaranteeing
      // the renderer always sees the correct props.data.
      {
        colId: 'sender',
        headerName: 'Sender',
        valueGetter: (p) => {
          const s = p.data?.sender;
          // Prefix with _id so this value is unique per row even when multiple
          // emails share the same sender name or email address.
          return `${p.data?._id ?? ''}\x00${s?.name ?? ''}\x00${s?.email ?? ''}`;
        },
        cellRenderer: SenderCellRenderer,
        minWidth: 150,
        width: 280,
        filter: 'agTextColumnFilter',
        sortable: true,
        resizable: true,
        cellClass: 'text-left',
      },
      // Mailbox (unified mode only)
      ...(isUnifiedMode
        ? [
            {
              colId: 'mailbox',
              headerName: 'Mailbox',
              valueGetter: (p: { data?: EventItem }) =>
                mailboxEmailMap?.get(p.data?.mailboxId || '') || p.data?.mailboxId || '',
              cellRenderer: MailboxCellRenderer,
              minWidth: 100,
              width: 180,
              filter: 'agTextColumnFilter',
              sortable: true,
              resizable: true,
            } as ColDef<EventItem>,
          ]
        : []),
      // Subject
      {
        colId: 'subject',
        field: 'subject',
        headerName: 'Subject',
        cellRenderer: SubjectCellRenderer,
        minWidth: 150,
        width: 300,
        flex: 1,
        filter: 'agTextColumnFilter',
        sortable: true,
        resizable: true,
      },
      // Date/Time
      {
        colId: 'time',
        field: 'timestamp',
        headerName: 'Date/Time',
        cellRenderer: TimeCellRenderer,
        minWidth: 120,
        width: 170,
        sortable: true,
        resizable: true,
        comparator: (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime(),
      },
      // Folder
      {
        colId: 'folder',
        headerName: 'Folder',
        valueGetter: (p) => p.data?.toFolder || p.data?.fromFolder || '',
        cellRenderer: FolderCellRenderer,
        minWidth: 80,
        width: 120,
        filter: 'agTextColumnFilter',
        sortable: true,
        resizable: true,
      },
      // Status
      {
        colId: 'status',
        field: 'isRead',
        headerName: 'Status',
        cellRenderer: StatusCellRenderer,
        minWidth: 60,
        width: 80,
        sortable: true,
        resizable: true,
        filter: 'agTextColumnFilter',
        filterValueGetter: (p) => (p.data?.isRead ? 'read' : 'unread'),
      },
      // Priority
      {
        colId: 'importance',
        field: 'importance',
        headerName: 'Priority',
        cellRenderer: ImportanceCellRenderer,
        minWidth: 60,
        width: 80,
        filter: 'agTextColumnFilter',
        sortable: true,
        resizable: true,
      },
      // Opens (sent folder only — always present so columnDefs stay stable)
      ...(folderFilter === 'sent'
        ? [
            {
              colId: 'opens',
              headerName: 'Opens',
              cellRenderer: OpensCellRenderer,
              minWidth: 60,
              width: 80,
              sortable: false,
              resizable: true,
            } as ColDef<EventItem>,
          ]
        : []),
      // Actions column (not in deleted folder)
      ...(folderFilter !== 'deleted'
        ? [
            {
              colId: 'actions',
              headerName: '',
              cellRenderer: ActionsCellRenderer,
              width: 60,
              minWidth: 50,
              maxWidth: 80,
              sortable: false,
              resizable: false,
              suppressMovable: true,
              pinned: 'right' as const,
            } as ColDef<EventItem>,
          ]
        : []),
    ];
    return cols;
  }, [isUnifiedMode, mailboxEmailMap, folderFilter, largeIcons]);

  // Row ID getter
  const getRowId = useCallback((params: GetRowIdParams<EventItem>) => params.data._id, []);

  // Row class rules for styling
  const rowClassRules = useMemo<RowClassRules<EventItem>>(
    () => ({
      'group/row': () => true,
      'bg-muted/30': (params) => !params.data?.isRead,
      'ag-row-active': (params) => params.data?._id === activeEventId,
      'ag-row-focused-custom': (params) =>
        params.data?._id === focusedEventId && params.data?._id !== activeEventId,
    }),
    [activeEventId, focusedEventId],
  );

  // Sync parent selectedIds → AG Grid selection
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    suppressSelectionSync.current = true;
    api.forEachNode((node) => {
      const shouldSelect = selectedIds.has(node.data?._id || '');
      if (node.isSelected() !== shouldSelect) {
        node.setSelected(shouldSelect);
      }
    });
    suppressSelectionSync.current = false;
  }, [selectedIds, data]);

  // AG Grid selection changed → sync to parent
  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent<EventItem>) => {
      if (suppressSelectionSync.current) return;
      const selected = event.api.getSelectedRows();
      const newIds = new Set(selected.map((e) => e._id));

      // Compute changes
      for (const id of newIds) {
        if (!selectedIds.has(id)) onToggleSelect(id);
      }
      for (const id of selectedIds) {
        if (!newIds.has(id)) onToggleSelect(id);
      }
    },
    [selectedIds, onToggleSelect],
  );

  // Row click handler
  const onRowClicked = useCallback(
    (params: { data?: EventItem; event?: Event | null }) => {
      if (!params.data || !onRowClick) return;
      // Don't trigger row click if user clicked a button/checkbox
      const target = params.event?.target as HTMLElement | undefined;
      if (target?.closest('button, [role="checkbox"], .ag-checkbox')) return;
      onRowClick(params.data);
    },
    [onRowClick],
  );

  // Per-folder storage key
  const columnStateKey = `${COLUMN_STATE_KEY_PREFIX}-${folderFilter}`;

  // Suppress saves while a folder transition / restore is in progress.
  // AG Grid fires onStateUpdated (with columnOrder source) when columnDefs change,
  // which would overwrite the saved Sent-folder preferences with the default layout
  // before the 50 ms restore timeout fires.
  const suppressSaveRef = useRef(false);

  // Save column state to localStorage (exclude AG Grid's internal selection column)
  const saveColumnState = useCallback((api: GridApi) => {
    if (suppressSaveRef.current) return;
    const state = api.getColumnState().filter((c) => c.colId !== 'ag-Grid-SelectionColumn');
    if (state?.length) {
      localStorage.setItem(columnStateKey, JSON.stringify(state));
    }
  }, [columnStateKey]);

  // Restore column state from localStorage
  const restoreColumnState = useCallback((api: GridApi) => {
    try {
      const saved = localStorage.getItem(columnStateKey);
      if (saved) {
        const state: ColumnState[] = (JSON.parse(saved) as ColumnState[]).filter(
          (c) => c.colId !== 'ag-Grid-SelectionColumn',
        );
        api.applyColumnState({ state, applyOrder: true });
        // Keep saves suppressed for one more tick so any post-applyColumnState
        // stateUpdated events don't overwrite what we just restored.
        setTimeout(() => { suppressSaveRef.current = false; }, 0);
      } else {
        suppressSaveRef.current = false;
      }
    } catch {
      suppressSaveRef.current = false;
    }
  }, [columnStateKey]);

  // Grid ready event
  const onGridReady = useCallback(
    (params: GridReadyEvent<EventItem>) => {
      apiRef.current = params.api;
      restoreColumnState(params.api);
    },
    [restoreColumnState],
  );

  // Re-apply saved column state when folder changes (columnDefs change).
  // Suppress saves immediately so the stateUpdated event AG Grid fires when
  // processing the new columnDefs doesn't clobber the stored preferences.
  useEffect(() => {
    const api = apiRef.current;
    if (api) {
      suppressSaveRef.current = true;
      // Small delay to let AG Grid process the new columnDefs first
      const t = setTimeout(() => restoreColumnState(api), 50);
      return () => {
        clearTimeout(t);
        suppressSaveRef.current = false;
      };
    }
  }, [columnStateKey, restoreColumnState]);

  // State updated → save column state
  const onStateUpdated = useCallback(
    (params: StateUpdatedEvent<EventItem>) => {
      // Only save on column-related state changes
      const sources = params.sources;
      if (
        sources.includes('columnOrder') ||
        sources.includes('columnSizing') ||
        sources.includes('columnVisibility') ||
        sources.includes('columnPinning') ||
        sources.includes('sort')
      ) {
        saveColumnState(params.api);
      }
    },
    [saveColumnState],
  );

  // Scroll focused row into view
  useEffect(() => {
    const api = apiRef.current;
    if (!focusedEventId || !api) return;
    const rowNode = api.getRowNode(focusedEventId);
    if (rowNode?.rowIndex != null) {
      api.ensureIndexVisible(rowNode.rowIndex, 'middle');
    }
  }, [focusedEventId]);

  // Default column settings
  const defaultColDef = useMemo<ColDef<EventItem>>(
    () => ({
      resizable: true,
      sortable: true,
      filter: showFilters,
      floatingFilter: showFilters,
      suppressHeaderMenuButton: true,
      wrapHeaderText: false,
      autoHeaderHeight: false,
    }),
    [showFilters],
  );

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      {/* Toolbar */}
      {!hideToolbar && (
        <div className="flex items-center gap-2">
          {/* Select all checkbox */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Select all"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>{allSelected ? 'Deselect all' : 'Select all'}</TooltipContent>
          </Tooltip>
          {toolbarSlot}
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="h-8 text-xs"
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Filters
          </Button>

          {/* Icon size toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={largeIcons ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={toggleIconSize}
              >
                {largeIcons ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{largeIcons ? 'Smaller icons' : 'Larger icons'}</TooltipContent>
          </Tooltip>

          {showFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                apiRef.current?.setFilterModel(null);
                setShowFilters(false);
              }}
            >
              Clear filters
              <X className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}

          {/* Reset column layout */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 text-xs"
            onClick={() => {
              localStorage.removeItem(columnStateKey);
              apiRef.current?.resetColumnState();
            }}
          >
            Reset Columns
          </Button>
        </div>
      )}

      {/* AG Grid */}
      <div className="rounded-md border overflow-hidden flex-1 min-h-[200px]">
        <AgGridReact<EventItem>
          ref={gridRef}
          theme={theme}
          rowData={data}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={gridContext}
          getRowId={getRowId}
          rowSelection={{ mode: 'multiRow', headerCheckbox: true, checkboxes: true }}
          rowClassRules={rowClassRules}
          onGridReady={onGridReady}
          onSelectionChanged={onSelectionChanged}
          onRowClicked={onRowClicked}
          onStateUpdated={onStateUpdated}
          suppressRowClickSelection={true}
          animateRows={false}
          enableCellTextSelection={true}
          suppressCellFocus={true}
          suppressColumnVirtualisation={true}
          domLayout="normal"
          headerHeight={38}
          rowHeight={42}
          rowDragManaged={true}
          tooltipShowDelay={300}
        />
      </div>

      {/* Row count */}
      <div className="text-xs text-muted-foreground">
        {data.length} rows
        {showFilters && ' (filters enabled)'}
      </div>
    </div>
  );
}
