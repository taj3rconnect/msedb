import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, Paperclip, ArrowRight, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { EVENT_TYPES } from '@/lib/constants';
import { formatRelativeTime, formatEmail } from '@/lib/formatters';
import type { EventItem } from '@/api/events';

interface EventsTableProps {
  data: EventItem[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  total: number;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  onPageChange: (page: number) => void;
}

/**
 * Data table for email events using TanStack Table with server-side sorting.
 */
export function EventsTable({
  data,
  isLoading,
  page,
  totalPages,
  total,
  sorting,
  onSortingChange,
  onPageChange,
}: EventsTableProps) {
  const columns = useMemo<ColumnDef<EventItem>[]>(
    () => [
      {
        accessorKey: 'eventType',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === 'asc')
            }
          >
            Type
            <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const type = row.getValue('eventType') as string;
          const config = EVENT_TYPES[type];
          return (
            <Badge variant="outline" className={config?.color ?? ''}>
              {config?.label ?? type}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'sender',
        header: 'Sender',
        enableSorting: false,
        cell: ({ row }) => {
          const sender = row.original.sender;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium truncate max-w-[200px]">
                {formatEmail(sender.email)}
              </span>
              {sender.domain && (
                <span className="text-xs text-muted-foreground">
                  {sender.domain}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'subject',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === 'asc')
            }
          >
            Subject
            <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const subject = row.getValue('subject') as string | undefined;
          if (!subject) return <span className="text-muted-foreground italic">No subject</span>;
          return (
            <span className="truncate max-w-[300px] block" title={subject}>
              {subject.length > 60 ? `${subject.slice(0, 57)}...` : subject}
            </span>
          );
        },
      },
      {
        id: 'folder',
        header: 'Folder',
        enableSorting: false,
        cell: ({ row }) => {
          const from = row.original.fromFolder;
          const to = row.original.toFolder;
          if (!from && !to) return <span className="text-muted-foreground">-</span>;
          if (from && to && from !== to) {
            return (
              <span className="flex items-center gap-1 text-xs">
                <span className="truncate max-w-[80px]">{from}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate max-w-[80px]">{to}</span>
              </span>
            );
          }
          return <span className="text-xs truncate max-w-[120px]">{to ?? from}</span>;
        },
      },
      {
        accessorKey: 'timestamp',
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === 'asc')
            }
          >
            Time
            <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const ts = row.getValue('timestamp') as string;
          return (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(ts)}
            </span>
          );
        },
      },
      {
        accessorKey: 'hasAttachments',
        header: '',
        enableSorting: false,
        cell: ({ row }) => {
          if (!row.getValue('hasAttachments')) return null;
          return <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />;
        },
        size: 40,
      },
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange(next);
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: totalPages,
  });

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No events found"
        description="No email events match your current filters. Try adjusting your filters or wait for new events to arrive."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} event{total !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
