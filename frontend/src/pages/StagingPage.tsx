import { useState, useEffect, useCallback } from 'react';
import { Clock, LifeBuoy, Zap, AlertCircle, Inbox } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  useStaging,
  useStagingCount,
  useRescueStagedEmail,
  useBatchRescue,
  useExecuteStagedEmail,
  useBatchExecute,
} from '@/hooks/useStaging';
import { useUiStore } from '@/stores/uiStore';
import type { StagedEmail } from '@/api/staging';

// --- useCountdown hook ---

/**
 * Returns a human-readable countdown string and color class for a staged email's expiration.
 * Updates every minute.
 */
function useCountdown(expiresAt: string): { text: string; colorClass: string } {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const ms = new Date(expiresAt).getTime() - now;

  if (ms <= 0) {
    return { text: 'Expired', colorClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' };
  }

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const text = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  let colorClass: string;
  if (hours >= 12) {
    colorClass = 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
  } else if (hours >= 4) {
    colorClass = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
  } else {
    colorClass = 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
  }

  return { text, colorClass };
}

// --- StagedEmailRow component ---

interface StagedEmailRowProps {
  email: StagedEmail;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onRescue: (id: string) => void;
  onExecute: (id: string) => void;
}

function StagedEmailRow({ email, selected, onSelect, onRescue, onExecute }: StagedEmailRowProps) {
  const { text: countdown, colorClass } = useCountdown(email.expiresAt);

  const truncatedId = email.messageId.length > 24
    ? `${email.messageId.slice(0, 24)}...`
    : email.messageId;

  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(email.id, checked === true)}
        />
      </TableCell>
      <TableCell className="font-mono text-xs" title={email.messageId}>
        {truncatedId}
      </TableCell>
      <TableCell>{email.originalFolder}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {email.actions.map((action, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {action.actionType}
              {action.toFolder ? ` -> ${action.toFolder}` : ''}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={colorClass}>
          <Clock className="h-3 w-3 mr-1" />
          {countdown}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRescue(email.id)}
            title="Rescue - keep email in inbox"
          >
            <LifeBuoy className="h-4 w-4 mr-1" />
            Rescue
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                title="Execute now - apply actions immediately"
              >
                <Zap className="h-4 w-4 mr-1" />
                Execute Now
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Execute staged action?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately apply the staged actions to this email.
                  This action cannot be easily undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onExecute(email.id)}>
                  Execute Now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

// --- StagingPage component ---

export function StagingPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Data hooks
  const { data, isLoading, isError } = useStaging({
    mailboxId: selectedMailboxId ?? undefined,
    status: 'staged',
    page,
    limit: 20,
  });
  const { data: countData } = useStagingCount();

  // Mutation hooks
  const rescueMutation = useRescueStagedEmail();
  const batchRescueMutation = useBatchRescue();
  const executeMutation = useExecuteStagedEmail();
  const batchExecuteMutation = useBatchExecute();

  const stagedEmails = data?.stagedEmails ?? [];
  const totalPages = data?.pagination.totalPages ?? 0;
  const stagingCount = countData?.count ?? 0;

  // Selection handlers
  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(stagedEmails.map((e) => e.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [stagedEmails],
  );

  // Action handlers
  const handleRescue = useCallback(
    (id: string) => {
      rescueMutation.mutate(id, {
        onSuccess: () => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      });
    },
    [rescueMutation],
  );

  const handleExecute = useCallback(
    (id: string) => {
      executeMutation.mutate(id, {
        onSuccess: () => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      });
    },
    [executeMutation],
  );

  const handleBatchRescue = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    batchRescueMutation.mutate(ids, {
      onSuccess: () => setSelectedIds(new Set()),
    });
  }, [selectedIds, batchRescueMutation]);

  const handleBatchExecute = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    batchExecuteMutation.mutate(ids, {
      onSuccess: () => setSelectedIds(new Set()),
    });
  }, [selectedIds, batchExecuteMutation]);

  const allSelected =
    stagedEmails.length > 0 && selectedIds.size === stagedEmails.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Staging</h1>
          {stagingCount > 0 && (
            <Badge variant="destructive">{stagingCount} pending</Badge>
          )}
        </div>
      </div>

      {/* Batch actions */}
      {selectedIds.size > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBatchRescue}
                disabled={batchRescueMutation.isPending}
              >
                <LifeBuoy className="h-4 w-4 mr-1" />
                Rescue Selected
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={batchExecuteMutation.isPending}
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    Execute Selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Execute {selectedIds.size} staged actions?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will immediately apply the staged actions to{' '}
                      {selectedIds.size} emails. This action cannot be easily
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBatchExecute}>
                      Execute All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading staged emails...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load staged emails"
          description="There was an error loading the staging queue. Please try again."
        />
      ) : stagedEmails.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No emails in staging"
          description="When automation rules match destructive actions, emails will appear here for review."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        handleSelectAll(checked === true)
                      }
                    />
                  </TableHead>
                  <TableHead>Message ID</TableHead>
                  <TableHead>Original Folder</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead>Time Remaining</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stagedEmails.map((email) => (
                  <StagedEmailRow
                    key={email.id}
                    email={email}
                    selected={selectedIds.has(email.id)}
                    onSelect={handleSelect}
                    onRescue={handleRescue}
                    onExecute={handleExecute}
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
