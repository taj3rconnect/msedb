import { FlaskConical, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SimulationResult } from '@/api/rules';
import { formatDateTime } from '@/lib/formatters';

interface SimulationResultPanelProps {
  result: SimulationResult | null;
  isLoading: boolean;
  onDateRangeChange?: (range: '30d' | '60d' | '90d') => void;
  currentDateRange?: string;
  onDismiss?: () => void;
}

const DATE_RANGES = ['30d', '60d', '90d'] as const;

export function SimulationResultPanel({
  result,
  isLoading,
  onDateRangeChange,
  currentDateRange = '30d',
  onDismiss,
}: SimulationResultPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
        <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
        <span className="text-sm text-amber-700 dark:text-amber-300">
          Scanning historical emails...
        </span>
      </div>
    );
  }

  if (!result) return null;

  const hasMatches = result.totalMatched > 0;

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {hasMatches ? (
            <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
          )}
          <div>
            {hasMatches ? (
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {result.totalMatched.toLocaleString()} of{' '}
                {result.scannedCount.toLocaleString()} emails would match
              </p>
            ) : (
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                No historical emails would match this rule
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Last {result.dateRange} scanned
            </p>
          </div>
        </div>

        {/* Date range toggle + dismiss */}
        <div className="flex items-center gap-1">
          {onDateRangeChange && DATE_RANGES.map((range) => (
            <Button
              key={range}
              variant={currentDateRange === range ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => onDateRangeChange(range)}
            >
              {range}
            </Button>
          ))}
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={onDismiss}
              title="Clear simulation"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Body contains caveat */}
      {result.bodyContainsSkipped && (
        <div className="flex items-start gap-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-100/50 dark:bg-amber-900/30 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            &quot;Body contains&quot; condition was skipped — email body text is not stored locally.
            Actual match count may differ.
          </p>
        </div>
      )}

      {/* Email preview list */}
      {hasMatches && result.emails.length > 0 && (
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-1">
            {result.emails.map((email) => {
              const dateStr = formatDateTime(email.timestamp);
              return (
                <div
                  key={email._id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-amber-100/50 dark:hover:bg-amber-900/20"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">
                      {email.sender.name || email.sender.email || 'Unknown'}
                    </span>
                    <span className="text-muted-foreground truncate block">
                      {email.subject || '(no subject)'}
                    </span>
                  </div>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {dateStr}
                  </span>
                </div>
              );
            })}
            {result.totalMatched > result.emails.length && (
              <p className="text-xs text-muted-foreground text-center py-1">
                ...and {(result.totalMatched - result.emails.length).toLocaleString()} more
              </p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
