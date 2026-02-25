import { useState, useCallback } from 'react';
import { CalendarClock, X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  useScheduledEmails,
  useScheduledCount,
  useCancelScheduledEmail,
} from '@/hooks/useScheduledEmails';
import type { ScheduledEmail } from '@/api/scheduledEmails';

// --- Status badge config ---

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  pending: { label: 'Pending', variant: 'default', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  sent: { label: 'Sent', variant: 'default', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  cancelled: { label: 'Cancelled', variant: 'secondary', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  failed: { label: 'Failed', variant: 'destructive', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

// --- Row component ---

function ScheduledEmailRow({
  email,
  onCancel,
}: {
  email: ScheduledEmail;
  onCancel: (id: string) => void;
}) {
  const scheduledDate = new Date(email.scheduledAt);
  const formatted = scheduledDate.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <TableRow>
      <TableCell className="max-w-[200px] truncate" title={email.to.join(', ')}>
        {email.to.join(', ')}
      </TableCell>
      <TableCell className="max-w-[250px] truncate" title={email.subject}>
        {email.subject}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {email.mailboxEmail}
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatted}</TableCell>
      <TableCell>
        <StatusBadge status={email.status} />
      </TableCell>
      <TableCell>
        {email.status === 'pending' && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel scheduled email?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will cancel the scheduled email to {email.to.join(', ')}.
                  The email will not be sent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction onClick={() => onCancel(email._id)}>
                  Cancel Email
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {email.status === 'failed' && email.error && (
          <span className="text-xs text-red-500 max-w-[200px] truncate block" title={email.error}>
            {email.error}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

// --- Page component ---

export function PendingMessagesPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useScheduledEmails({ page, limit: 20 });
  const { data: countData } = useScheduledCount();
  const cancelMutation = useCancelScheduledEmail();

  const scheduledEmails = data?.scheduledEmails ?? [];
  const totalPages = data?.pagination.totalPages ?? 0;
  const pendingCount = countData?.count ?? 0;

  const handleCancel = useCallback(
    (id: string) => {
      cancelMutation.mutate(id, {
        onSuccess: () => {
          toast.success('Scheduled email cancelled');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to cancel');
        },
      });
    },
    [cancelMutation],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Pending Messages</h1>
        {pendingCount > 0 && (
          <Badge variant="secondary">{pendingCount} pending</Badge>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <Card>
          <CardContent>
            <div className="space-y-3 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load scheduled emails"
          description="There was an error loading the scheduled emails. Please try again."
        />
      ) : scheduledEmails.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled messages"
          description="When you schedule an email for later, it will appear here."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Scheduled Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduledEmails.map((email) => (
                  <ScheduledEmailRow
                    key={email._id}
                    email={email}
                    onCancel={handleCancel}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
