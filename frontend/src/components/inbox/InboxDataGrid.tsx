import { useState, useMemo, useCallback } from 'react';
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
  MailOpen,
  MoreHorizontal,
  GripVertical,
  SlidersHorizontal,
  Trash2,
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
interface InboxDataGridProps {
  data: EventItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  someSelected: boolean;
  onAction: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onJustDelete: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
}

export function InboxDataGrid({
  data,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  someSelected,
  onAction,
  onQuickDelete,
  onJustDelete,
  onQuickMarkRead,
}: InboxDataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showFilters, setShowFilters] = useState(true);

  // Default column order
  const defaultColumnOrder = [
    'select',
    'sender',
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
        (row) => row.sender.name || row.sender.email || '',
        {
          id: 'sender',
          header: 'Sender',
          size: 240,
          filterFn: 'includesString',
          cell: ({ row }) => {
            const event = row.original;
            return (
              <div className="flex items-center gap-0.5 min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-destructive transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJustDelete(event);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete this email</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-destructive transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickDelete(event);
                      }}
                      disabled={!event.sender.email}
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Always delete from this sender</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-blue-500 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickMarkRead(event);
                      }}
                      disabled={!event.sender.email}
                    >
                      <MailOpen className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Always mark read from this sender</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:!text-foreground transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction(event);
                      }}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Create custom rule</TooltipContent>
                </Tooltip>
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {event.sender.name || event.sender.email}
                  </div>
                  {event.sender.name && event.sender.email && (
                    <div className="text-xs text-muted-foreground truncate">
                      {event.sender.email}
                    </div>
                  )}
                </div>
              </div>
            );
          },
        },
      ),
      // Subject
      columnHelper.accessor('subject', {
        id: 'subject',
        header: 'Subject',
        size: 300,
        filterFn: 'includesString',
        cell: ({ getValue }) => (
          <span className="truncate block max-w-xs">
            {getValue() || '(no subject)'}
          </span>
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
      // Actions
      columnHelper.display({
        id: 'actions',
        size: 60,
        enableSorting: false,
        enableColumnFilter: false,
        header: '',
        cell: ({ row }) => (
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
      }),
    ],
    [allSelected, someSelected, selectedIds, onToggleSelectAll, onToggleSelect, onAction, onQuickDelete, onJustDelete, onQuickMarkRead],
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

  // Columns that can be toggled
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions');

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
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

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full caption-bottom text-sm">
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
                    className={`group/row border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted ${
                      row.original.isRead ? '' : 'bg-muted/30'
                    }`}
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
