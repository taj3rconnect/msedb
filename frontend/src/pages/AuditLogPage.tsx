import { useState, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { AlertCircle, FileText, Undo2, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { useAudit, useUndoAction } from '@/hooks/useAudit';
import { useUiStore } from '@/stores/uiStore';
import type { AuditLogEntry } from '@/api/audit';

// --- Action badge colors ---

const ACTION_COLORS: Record<string, string> = {
  rule_created: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  rule_executed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  email_staged: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  email_rescued: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  email_executed: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  pattern_approved: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  pattern_rejected: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  undo_action: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  whitelist_updated: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const ACTION_OPTIONS = [
  { value: 'all', label: 'All Actions' },
  { value: 'rule_created', label: 'Rule Created' },
  { value: 'rule_executed', label: 'Rule Executed' },
  { value: 'email_staged', label: 'Email Staged' },
  { value: 'email_rescued', label: 'Email Rescued' },
  { value: 'email_executed', label: 'Email Executed' },
  { value: 'pattern_approved', label: 'Pattern Approved' },
  { value: 'pattern_rejected', label: 'Pattern Rejected' },
  { value: 'undo_action', label: 'Undo Action' },
  { value: 'whitelist_updated', label: 'Whitelist Updated' },
];

/**
 * Generate a brief human-readable summary from an audit action and details.
 */
function summarizeDetails(action: string, details: Record<string, unknown>): string {
  const sender = details.senderEmail as string | undefined;
  const folder = details.toFolder as string | undefined;
  const actionType = details.actionType as string | undefined;

  switch (action) {
    case 'rule_created':
      return sender ? `Created rule for ${sender}` : 'Created automation rule';
    case 'rule_executed':
      return actionType
        ? `${actionType}${sender ? ` email from ${sender}` : ''}${folder ? ` to ${folder}` : ''}`
        : 'Executed rule action';
    case 'email_staged':
      return sender ? `Staged email from ${sender}` : 'Email staged for review';
    case 'email_rescued':
      return sender ? `Rescued email from ${sender}` : 'Email rescued from staging';
    case 'email_executed':
      return sender
        ? `Executed staged action on email from ${sender}`
        : 'Executed staged action';
    case 'pattern_approved':
      return sender ? `Approved pattern for ${sender}` : 'Pattern approved';
    case 'pattern_rejected':
      return sender ? `Rejected pattern for ${sender}` : 'Pattern rejected';
    case 'undo_action':
      return 'Reversed previous action';
    case 'whitelist_updated':
      return 'Updated sender whitelist';
    default:
      return action.replace(/_/g, ' ');
  }
}

/**
 * Check if an audit entry is eligible for undo:
 * - Must be undoable
 * - Must not already be undone
 * - Must be within 48 hours
 */
function canUndo(entry: AuditLogEntry): boolean {
  if (!entry.undoable || entry.undoneAt) return false;
  const createdMs = new Date(entry.createdAt).getTime();
  const now = Date.now();
  const fortyEightHours = 48 * 60 * 60 * 1000;
  return now - createdMs < fortyEightHours;
}

// --- AuditRow component ---

interface AuditRowProps {
  entry: AuditLogEntry;
  onUndo: (id: string) => void;
  isUndoing: boolean;
}

function AuditRow({ entry, onUndo, isUndoing }: AuditRowProps) {
  const actionColor = ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  const actionLabel = entry.action.replace(/_/g, ' ');

  const relativeTime = formatDistanceToNow(new Date(entry.createdAt), {
    addSuffix: true,
  });
  const fullTimestamp = format(new Date(entry.createdAt), 'PPpp');

  return (
    <TableRow>
      <TableCell title={fullTimestamp}>
        <span className="text-sm">{relativeTime}</span>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={actionColor}>
          {actionLabel}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {entry.targetType}:{entry.targetId?.slice(0, 12)}
      </TableCell>
      <TableCell className="max-w-xs truncate">
        {summarizeDetails(entry.action, entry.details)}
      </TableCell>
      <TableCell>
        {entry.undoneAt ? (
          <Badge variant="secondary" className="text-xs">
            Undone
          </Badge>
        ) : canUndo(entry) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUndo(entry.id)}
            disabled={isUndoing}
          >
            <Undo2 className="h-4 w-4 mr-1" />
            Undo
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// --- AuditLogPage component ---

export function AuditLogPage() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ruleIdFilter, setRuleIdFilter] = useState('');

  // Build query params
  const queryParams = {
    mailboxId: selectedMailboxId ?? undefined,
    action: actionFilter !== 'all' ? actionFilter : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    ruleId: ruleIdFilter || undefined,
    page,
    limit: 20,
  };

  const { data, isLoading, isError } = useAudit(queryParams);
  const undoMutation = useUndoAction();

  const auditLogs = data?.auditLogs ?? [];
  const totalPages = data?.pagination.totalPages ?? 0;

  const hasFilters = actionFilter !== 'all' || startDate || endDate || ruleIdFilter;

  const handleClearFilters = useCallback(() => {
    setActionFilter('all');
    setStartDate('');
    setEndDate('');
    setRuleIdFilter('');
    setPage(1);
  }, []);

  const handleUndo = useCallback(
    (id: string) => {
      undoMutation.mutate(id);
    },
    [undoMutation],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Action Type
              </label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="w-[160px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="w-[160px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Rule ID
              </label>
              <Input
                type="text"
                placeholder="Filter by rule..."
                value={ruleIdFilter}
                onChange={(e) => { setRuleIdFilter(e.target.value); setPage(1); }}
                className="w-[160px]"
              />
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
              >
                <X className="h-4 w-4 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isLoading ? (
        <Card>
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
          title="Failed to load audit logs"
          description="There was an error loading the audit history. Please try again."
        />
      ) : auditLogs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No audit entries yet"
          description={
            hasFilters
              ? 'No entries match your current filters. Try adjusting or clearing them.'
              : 'Automated actions and rule changes will appear here.'
          }
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Undo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    onUndo={handleUndo}
                    isUndoing={undoMutation.isPending}
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
