import { Trash2, MailCheck, ListFilter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InboxBulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  deletePending: boolean;
  onMarkRead: () => void;
  markReadPending: boolean;
  onCreateRules: () => void;
  onClear: () => void;
}

export function InboxBulkActionBar({
  selectedCount,
  onDelete,
  deletePending,
  onMarkRead,
  markReadPending,
  onCreateRules,
  onClear,
}: InboxBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="shrink-0 flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2 mb-3">
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>
      <Button
        size="sm"
        variant="destructive"
        onClick={onDelete}
        disabled={deletePending}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        {deletePending ? 'Deleting...' : 'Delete'}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onMarkRead}
        disabled={markReadPending}
      >
        <MailCheck className="mr-1.5 h-3.5 w-3.5" />
        {markReadPending ? 'Marking...' : 'Mark Read'}
      </Button>
      <Button size="sm" variant="outline" onClick={onCreateRules}>
        <ListFilter className="mr-1.5 h-3.5 w-3.5" />
        Create Rules
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
