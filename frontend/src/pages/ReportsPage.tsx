import { useState } from 'react';
import { format } from 'date-fns';
import {
  BarChart3,
  AlertCircle,
  Trash2,
  FolderInput,
  ArrowRightLeft,
  Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { useActivityReport } from '@/hooks/useReports';
import type { ReportPeriod, MailboxCounts } from '@/api/reports';

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'lastWeek', label: 'Last Week' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'ytd', label: 'Year to Date' },
];

const COLUMN_COLORS = {
  deleted: 'text-red-600 dark:text-red-400',
  movedAndRead: 'text-blue-600 dark:text-blue-400',
  movedOnly: 'text-yellow-600 dark:text-yellow-400',
  markedRead: 'text-green-600 dark:text-green-400',
} as const;

const DOT_COLORS = {
  deleted: 'bg-red-500',
  movedAndRead: 'bg-blue-500',
  movedOnly: 'bg-yellow-500',
  markedRead: 'bg-green-500',
} as const;

function fmt(n: number): string {
  return n.toLocaleString();
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${format(s, 'MMM d, yyyy h:mm a')} — ${format(e, 'MMM d, yyyy h:mm a')} EST`;
}

function CellValue({ value, color }: { value: number; color?: string }) {
  if (value === 0) {
    return <span className="text-muted-foreground/50">0</span>;
  }
  return <span className={color}>{fmt(value)}</span>;
}

function ReportRow({ row, isTotals }: { row: MailboxCounts; isTotals?: boolean }) {
  const total = row.deleted + row.movedAndRead + row.movedOnly + row.markedRead;
  const cls = isTotals ? 'font-semibold bg-muted/50 border-t-2' : '';

  return (
    <TableRow className={cls}>
      <TableCell className="font-medium">
        {isTotals ? (
          <span className="uppercase text-xs tracking-wider text-muted-foreground">All Mailboxes</span>
        ) : (
          row.email
        )}
      </TableCell>
      <TableCell className="text-center"><CellValue value={row.deleted} color={COLUMN_COLORS.deleted} /></TableCell>
      <TableCell className="text-center"><CellValue value={row.movedAndRead} color={COLUMN_COLORS.movedAndRead} /></TableCell>
      <TableCell className="text-center"><CellValue value={row.movedOnly} color={COLUMN_COLORS.movedOnly} /></TableCell>
      <TableCell className="text-center"><CellValue value={row.markedRead} color={COLUMN_COLORS.markedRead} /></TableCell>
      <TableCell className="text-center font-bold">{total === 0 ? <span className="text-muted-foreground/50">0</span> : fmt(total)}</TableCell>
    </TableRow>
  );
}

function ColorDot({ color }: { color: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${color} mr-1.5`} />;
}

export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const { data, isLoading, isError } = useActivityReport(period);

  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Activity Report</h1>
        <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data?.start && data?.end && (
        <p className="text-sm text-muted-foreground">
          {formatRange(data.start, data.end)}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load report"
          description="There was an error loading the activity report. Please try again."
        />
      ) : !data || data.mailboxes.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No activity data"
          description="No rule-based activity was recorded for this period."
        />
      ) : (
        <>
          {/* Summary cards */}
          {data.totals && (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <SummaryCard title="Deleted" value={data.totals.deleted} color={COLUMN_COLORS.deleted} icon={Trash2} dotColor={DOT_COLORS.deleted} />
              <SummaryCard title="Moved & Read" value={data.totals.movedAndRead} color={COLUMN_COLORS.movedAndRead} icon={FolderInput} dotColor={DOT_COLORS.movedAndRead} />
              <SummaryCard title="Moved Only" value={data.totals.movedOnly} color={COLUMN_COLORS.movedOnly} icon={ArrowRightLeft} dotColor={DOT_COLORS.movedOnly} />
              <SummaryCard title="Mark Read" value={data.totals.markedRead} color={COLUMN_COLORS.markedRead} icon={Eye} dotColor={DOT_COLORS.markedRead} />
            </div>
          )}

          {/* Report table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Rule Activity — {periodLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mailbox</TableHead>
                    <TableHead className="text-center"><ColorDot color={DOT_COLORS.deleted} />Deleted</TableHead>
                    <TableHead className="text-center"><ColorDot color={DOT_COLORS.movedAndRead} />Moved & Read</TableHead>
                    <TableHead className="text-center"><ColorDot color={DOT_COLORS.movedOnly} />Moved Only</TableHead>
                    <TableHead className="text-center"><ColorDot color={DOT_COLORS.markedRead} />Mark Read</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.mailboxes.map((mb) => (
                    <ReportRow key={mb.email} row={mb} />
                  ))}
                  {data.totals && <ReportRow row={data.totals} isTotals />}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({ title, value, color, icon: Icon, dotColor }: {
  title: string;
  value: number;
  color: string;
  icon: LucideIcon;
  dotColor: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className={`rounded-md p-1.5 ${dotColor}/10`}>
            <Icon className={`h-4 w-4 ${color}`} />
          </div>
        </div>
        <p className={`text-3xl font-bold mt-1 ${color}`}>{fmt(value)}</p>
      </CardContent>
    </Card>
  );
}
