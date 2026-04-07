import { format } from 'date-fns';
import { Calendar, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { useCalendarEvents, useCalendarSyncStatus } from '@/hooks/useCalendar';
import type { CalendarEventItem } from '@/api/calendar';

function formatDt(dt: string, isAllDay: boolean): string {
  const d = new Date(dt);
  return isAllDay ? format(d, 'MMM d, yyyy') : format(d, 'MMM d, yyyy h:mm a');
}

function formatLastSync(dt: string | null): string {
  if (!dt) return 'Never';
  return format(new Date(dt), 'MMM d, h:mm a');
}

function mailboxLabel(mb: { email: string; displayName?: string } | null): string {
  if (!mb) return '—';
  return mb.displayName ? `${mb.displayName} (${mb.email})` : mb.email;
}

function SyncStatusSection() {
  const { data, isLoading } = useCalendarSyncStatus();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[100px] rounded-xl" />)}
      </div>
    );
  }

  if (!data?.mailboxes.length) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {data.mailboxes.map((mb) => (
        <Card key={mb.mailboxId}>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <p className="text-sm font-medium truncate">{mb.email}</p>
            </div>
            <p className="text-2xl font-bold">{mb.totalSynced}</p>
            <p className="text-xs text-muted-foreground">synced events</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Last sync: {formatLastSync(mb.lastSyncedAt)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: CalendarEventItem }) {
  const mirrorEmails = event.mirrors.map((m) => m.mailbox?.email ?? '?');

  return (
    <TableRow>
      <TableCell className="font-medium max-w-[240px] truncate">{event.subject || '(No subject)'}</TableCell>
      <TableCell className="whitespace-nowrap">{formatDt(event.startDateTime, event.isAllDay)}</TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[160px]">
        {mailboxLabel(event.sourceMailbox)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {mirrorEmails.map((email) => (
            <Badge key={email} variant="secondary" className="text-xs">
              {email}
            </Badge>
          ))}
          {mirrorEmails.length === 0 && (
            <span className="text-xs text-muted-foreground">None yet</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CalendarPage() {
  const { data, isLoading, isError } = useCalendarEvents(true);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Calendar Sync</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Events created, updated, or deleted in any connected account are automatically mirrored to all other accounts.
      </p>

      <SyncStatusSection />

      {isLoading ? (
        <Skeleton className="h-[300px] rounded-xl" />
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load events"
          description="There was an error loading synced calendar events."
        />
      ) : !data?.events.length ? (
        <EmptyState
          icon={Calendar}
          title="No synced events yet"
          description="Create a calendar event in any connected account and it will appear here once synced."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upcoming Synced Events</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Created in</TableHead>
                  <TableHead>Mirrored to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
