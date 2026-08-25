import { Loader2, RefreshCw, Sparkles, Brain, PanelRight, PanelBottom } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailFilter, RuleActionCounts } from '@/api/events';

// Same shape as DATE_FILTERS above. "Read" and "Deleted" mean a RULE did it --
// the tooltip says so, because the words alone would suggest plain read/deleted
// mail and quietly misrepresent what the user is looking at.
const MAIL_FILTERS: ReadonlyArray<readonly [MailFilter, string, string]> = [
  ['unread', 'Unread', 'Unread emails'],
  ['all', 'All', 'All emails'],
  ['read', 'Read', 'Emails marked read by a rule'],
  ['deleted', 'Deleted', 'Emails deleted by a rule'],
] as const;

const DATE_FILTERS = [
  ['all', 'All'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this-week', 'This Week'],
  ['last-week', 'Last Week'],
  ['this-month', 'This Month'],
  ['last-month', 'Last Month'],
  ['ytd', 'YTD'],
  ['last-year', 'Last Year'],
] as const;

interface InboxFilterToolbarProps {
  onReset: () => void;
  onSync: () => void;
  syncPending: boolean;
  onSummarize: () => void;
  summarizePending: boolean;
  onAiSearch: () => void;
  dateFilter: string;
  onDateFilterChange: (filter: string) => void;
  mailFilter: MailFilter;
  onMailFilterChange: (filter: MailFilter) => void;
  ruleActionCounts?: RuleActionCounts;
  totalCount?: number;
  previewPosition: 'right' | 'bottom';
  onPreviewPositionChange: (pos: 'right' | 'bottom') => void;
}

export function InboxFilterToolbar({
  onReset,
  onSync,
  syncPending,
  onSummarize,
  summarizePending,
  onAiSearch,
  dateFilter,
  onDateFilterChange,
  mailFilter,
  onMailFilterChange,
  ruleActionCounts,
  totalCount,
  previewPosition,
  onPreviewPositionChange,
}: InboxFilterToolbarProps) {
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-1 mb-3">
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onReset}
        title="Reset filters & refresh"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={onSync}
        disabled={syncPending}
        title="Sync recent emails from Microsoft 365"
      >
        {syncPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
        )}
        Sync
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={onSummarize}
        disabled={summarizePending}
        title="AI summary of today's emails"
      >
        {summarizePending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-3.5 w-3.5" />
        )}
        Summarize
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={onAiSearch}
        title="AI-powered semantic email search"
      >
        <Brain className="mr-1 h-3.5 w-3.5 text-purple-500" />
        AI Search
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" />
      {DATE_FILTERS.map(([key, label]) => (
        <Button
          key={key}
          variant={dateFilter === key ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onDateFilterChange(key)}
        >
          {label}
        </Button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" />
      {MAIL_FILTERS.map(([key, label, title]) => {
        const count =
          key === 'read'
            ? ruleActionCounts?.read
            : key === 'deleted'
              ? ruleActionCounts?.deleted
              : undefined;
        return (
          <Button
            key={key}
            variant={mailFilter === key ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => onMailFilterChange(key)}
            title={title}
            aria-pressed={mailFilter === key}
          >
            {label}
            {count !== undefined && (
              <span
                className={`ml-1 rounded px-1 tabular-nums ${
                  mailFilter === key ? 'bg-background/25' : 'bg-muted'
                }`}
              >
                {count}
              </span>
            )}
          </Button>
        );
      })}
      {totalCount !== undefined && (
        <span className="text-sm text-muted-foreground tabular-nums ml-2">
          {totalCount.toLocaleString()} {totalCount === 1 ? 'email' : 'emails'}
        </span>
      )}
      <span className="mx-1 h-5 w-px bg-border" />
      <Button
        variant={previewPosition === 'right' ? 'default' : 'outline'}
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPreviewPositionChange('right')}
        title="Preview on right"
      >
        <PanelRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={previewPosition === 'bottom' ? 'default' : 'outline'}
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onPreviewPositionChange('bottom')}
        title="Preview on bottom"
      >
        <PanelBottom className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
