import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
  type ColumnOrderState,
  type VisibilityState,
  type Header,
} from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ban,
  CheckCircle,
  Mail,
  MailCheck,
  MailOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  GripVertical,
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { EventItem } from '@/api/events';
import { TrackingTooltip } from './TrackingTooltip';
import { useUiStore } from '@/stores/uiStore';

// --- Column Helper ---
const columnHelper = createColumnHelper<EventItem>();

// --- Sortable Header Cell ---
function SortableHeaderCell({
  header,
}: {
  header: Header<EventItem, unknown>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.column.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  };

  const canSort = header.column.getCanSort();

  return (
    <th
      ref={setNodeRef}
      style={style}
      className="h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 whitespace-nowrap select-none"
      colSpan={header.colSpan}
    >
      <div className="flex items-center gap-1">
        {/* Drag handle */}
        <button
          type="button"
          className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        {/* Header label + sort button */}
        {canSort ? (
          <button
            type="button"
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={header.column.getToggleSortingHandler()}
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
            {header.column.getIsSorted() === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : header.column.getIsSorted() === 'desc' ? (
              <ArrowDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        ) : (
          flexRender(header.column.columnDef.header, header.getContext())
        )}
      </div>
    </th>
  );
}

// --- Main Component ---
/**
 * Highlight search terms in text by wrapping matches in <mark> tags.
 */
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
  const iconSize = largeIcons ? 20 : 16;
  const btnPad = largeIcons ? 8 : 6;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showFiltersInternal, setShowFiltersInternal] = useState(false);
  const showFilters = showFiltersProp ?? showFiltersInternal;
  const setShowFilters = onToggleFilters ?? setShowFiltersInternal;

  // Default column order
  const defaultColumnOrder = [
    'select',
    'sender',
    ...(isUnifiedMode ? ['mailbox'] : []),
    'subject',
    'time',
    'folder',
    'status',
    'importance',
    'actions',
  ];
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(defaultColumnOrder);

  // Column definitions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<any[]>(
    () => [
      // Select checkbox (not sortable, not filterable, not reorderable)
      columnHelper.display({
        id: 'select',
        size: 40,
        enableSorting: false,
        enableColumnFilter: false,
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={onToggleSelectAll}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original._id)}
            onCheckedChange={() => onToggleSelect(row.original._id)}
          />
        ),
      }),
      // Sender
      columnHelper.accessor(
        (row) => row.sender?.name || row.sender?.email || '',
        {
          id: 'sender',
          header: 'Sender',
          size: 240,
          filterFn: 'includesString',
          cell: ({ row }) => {
            const event = row.original;
            return (
              <div className="flex items-center gap-2 min-w-0">
                {folderFilter === 'deleted' ? (
                  /* Deleted folder: only show Undelete button */
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-green-600 hover:!text-green-500 transition-all"
                        style={{ padding: btnPad }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUndelete?.(event);
                        }}
                      >
                        <Undo2 style={{ width: iconSize, height: iconSize }} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Undelete & remove rules for this sender</TooltipContent>
                  </Tooltip>
                ) : (
                  /* Inbox: show all action buttons */
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-green-600 hover:!text-green-500 transition-all"
                        style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearRules(event);
                          }}
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
                          className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-destructive transition-all"
                          style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onJustDelete(event);
                          }}
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
                          className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-destructive transition-all"
                          style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickDelete(event);
                          }}
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
                          className={`shrink-0 rounded opacity-0 group-hover/row:opacity-100 transition-all ${event.isRead ? 'text-muted-foreground/30 cursor-default' : 'text-muted-foreground hover:!text-green-500'}`}
                          style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!event.isRead) onMarkRead(event);
                          }}
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
                          className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-blue-500 transition-all"
                          style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickMarkRead(event);
                          }}
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
                          className="shrink-0 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-foreground transition-all"
                          style={{ padding: btnPad }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAction(event);
                          }}
                        >
                          <MoreHorizontal style={{ width: iconSize, height: iconSize }} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Create custom rule</TooltipContent>
                    </Tooltip>
                  </>
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate" dangerouslySetInnerHTML={{
                    __html: highlightText(event.sender?.name || event.sender?.email || '', searchQuery),
                  }} />
                  {event.sender?.name && event.sender?.email && (
                    <div className="text-xs text-muted-foreground truncate" dangerouslySetInnerHTML={{
                      __html: highlightText(event.sender.email, searchQuery),
                    }} />
                  )}
                </div>
              </div>
            );
          },
        },
      ),
      // Mailbox (unified mode only)
      ...(isUnifiedMode ? [columnHelper.accessor(
        (row) => mailboxEmailMap?.get(row.mailboxId) || row.mailboxId,
        {
          id: 'mailbox',
          header: 'Mailbox',
          size: 180,
          filterFn: 'includesString',
          cell: ({ getValue }) => {
            const email = getValue();
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
          },
        },
      )] : []),
      // Subject
      columnHelper.accessor('subject', {
        id: 'subject',
        header: 'Subject',
        size: 300,
        filterFn: 'includesString',
        cell: ({ getValue }) => (
          <span className="truncate block max-w-xs" dangerouslySetInnerHTML={{
            __html: highlightText(getValue() || '(no subject)', searchQuery),
          }} />
        ),
      }),
      // Folder
      columnHelper.accessor(
        (row) => row.toFolder || row.fromFolder || '',
        {
          id: 'folder',
          header: 'Folder',
          size: 120,
          filterFn: 'includesString',
          cell: ({ getValue }) => (
            <span className="text-sm text-muted-foreground truncate block">
              {getValue() || '—'}
            </span>
          ),
        },
      ),
      // Status
      columnHelper.accessor('isRead', {
        id: 'status',
        header: 'Status',
        size: 80,
        filterFn: (row, _columnId, filterValue) => {
          if (!filterValue) return true;
          const lower = String(filterValue).toLowerCase();
          if (lower === 'unread') return !row.original.isRead;
          if (lower === 'read') return row.original.isRead;
          return true;
        },
        cell: ({ getValue }) =>
          getValue() ? (
            <span className="text-xs text-muted-foreground">Read</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
              Unread
            </span>
          ),
      }),
      // Importance
      columnHelper.accessor('importance', {
        id: 'importance',
        header: 'Priority',
        size: 80,
        filterFn: 'includesString',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v === 'high') {
            return (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                High
              </span>
            );
          }
          if (v === 'low') {
            return (
              <span className="text-xs text-muted-foreground">Low</span>
            );
          }
          return <span className="text-xs text-muted-foreground">Normal</span>;
        },
      }),
      // Time
      columnHelper.accessor('timestamp', {
        id: 'time',
        header: 'Date/Time',
        size: 170,
        enableColumnFilter: false,
        cell: ({ getValue }) => {
          const d = new Date(getValue());
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
        },
      }),
      // Opens (tracking column, shown only in sent folder)
      ...(folderFilter === 'sent' && trackingMap ? [columnHelper.display({
        id: 'opens',
        size: 80,
        enableSorting: false,
        enableColumnFilter: false,
        header: 'Opens',
        cell: ({ row }: { row: { original: EventItem } }) => {
          const event = row.original;
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
        },
      })] : []),
      // Actions (hidden in deleted folder view)
      ...(folderFilter !== 'deleted' ? [columnHelper.display({
        id: 'actions',
        size: 60,
        enableSorting: false,
        enableColumnFilter: false,
        header: '',
        cell: ({ row }: { row: { original: EventItem } }) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onAction(row.original)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create rule</TooltipContent>
          </Tooltip>
        ),
      })] : []),
    ],
    [allSelected, someSelected, selectedIds, onToggleSelectAll, onToggleSelect, onAction, onClearRules, onQuickDelete, onJustDelete, onMarkRead, onQuickMarkRead, onUndelete, folderFilter, isUnifiedMode, mailboxEmailMap, trackingMap],
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnOrder,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // DnD sensors for column reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setColumnOrder((prev) => {
        const oldIndex = prev.indexOf(String(active.id));
        const newIndex = prev.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    [],
  );

  const activeFilterCount = columnFilters.length;
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  // Scroll focused row into view
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (!focusedEventId || !tableRef.current) return;
    const row = tableRef.current.querySelector(`[data-focused="true"]`);
    if (row) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedEventId]);

  // Columns that can be toggled
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions');

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      {!hideToolbar && (
        <div className="flex items-center gap-2">
          {toolbarSlot}
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="h-8 text-xs"
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary text-primary-foreground px-1.5 text-[10px]">
                {activeFilterCount}
              </span>
            )}
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

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setColumnFilters([])}
            >
              Clear filters
              <X className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}

          {/* Column visibility */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto h-8 text-xs">
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[180px] p-2">
              <div className="space-y-1">
                {toggleableColumns.map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={column.getIsVisible()}
                      onCheckedChange={(v) => column.toggleVisibility(!!v)}
                    />
                    {String(column.columnDef.header || column.id)}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table ref={tableRef} className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b">
              {headerGroups.map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b transition-colors">
                  <SortableContext
                    items={columnOrder}
                    strategy={horizontalListSortingStrategy}
                  >
                    {headerGroup.headers.map((header) => (
                      <SortableHeaderCell key={header.id} header={header} />
                    ))}
                  </SortableContext>
                </tr>
              ))}

              {/* Filter row */}
              {showFilters && (
                <tr className="border-b bg-muted/30">
                  {headerGroups[0]?.headers.map((header) => (
                    <th key={header.id} className="px-3 py-1.5">
                      {header.column.getCanFilter() ? (
                        <Input
                          placeholder={`Filter...`}
                          value={
                            (header.column.getFilterValue() as string) ?? ''
                          }
                          onChange={(e) =>
                            header.column.setFilterValue(
                              e.target.value || undefined,
                            )
                          }
                          className="h-7 text-xs"
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            <tbody className="[&_tr:last-child]:border-0">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={headerGroups[0]?.headers.length ?? 1}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No results match your filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={
                      selectedIds.has(row.original._id)
                        ? 'selected'
                        : undefined
                    }
                    data-focused={focusedEventId === row.original._id ? 'true' : undefined}
                    className={`group/row border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted ${
                      row.original.isRead ? '' : 'bg-muted/30'
                    } ${activeEventId === row.original._id ? 'ring-1 ring-inset ring-primary/40 bg-primary/5' : ''} ${focusedEventId === row.original._id && activeEventId !== row.original._id ? 'ring-1 ring-inset ring-dashed ring-primary/30 bg-primary/[0.02]' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-middle">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DndContext>
      </div>

      {/* Row count */}
      <div className="text-xs text-muted-foreground">
        {table.getFilteredRowModel().rows.length} of {data.length} rows
        {activeFilterCount > 0 && ' (filtered)'}
      </div>
    </div>
  );
}
