import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Trash2, MailOpen } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAllPatterns, useBulkApprovePatterns } from '@/hooks/usePatterns';
import type { BulkRuleAction, Pattern } from '@/api/patterns';

/** Filters currently applied on the patterns page — the drawer never widens them. */
export interface BulkRuleFilters {
  mailboxId?: string | null;
  /** Server-side status filter ('all' -> undefined). */
  status?: string;
  /** Server-side hasRule filter. */
  hasRule?: boolean;
  /** Server-side search string. */
  search?: string;
  /** Client-side pattern type filter ('all' means no filter). */
  patternType: string;
  /** Human-readable summary of the above, shown in the drawer header. */
  summary: string;
}

interface BulkRuleDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: BulkRuleFilters;
}

// Smart defaults — the common case, not a blank form.
const DEFAULT_MIN_ACTED = 90;
const DEFAULT_MIN_CONFIDENCE = 85;
const DEFAULT_MIN_OBSERVED = 10;

const ACTION_VERB: Record<string, string> = {
  delete: 'deleted',
  move: 'moved',
  archive: 'archived',
  markRead: 'marked read',
  flag: 'flagged',
  categorize: 'categorized',
};

/** Percentage of observed emails on which the user actually took the pattern's action. */
export function actedRate(pattern: Pattern): number {
  if (!pattern.sampleSize) return 0;
  return ((pattern.sampleSize - pattern.exceptionCount) / pattern.sampleSize) * 100;
}

function senderLabel(pattern: Pattern): string {
  return (
    pattern.condition.senderEmail ??
    pattern.condition.senderDomain ??
    pattern.condition.subjectPattern ??
    'unknown sender'
  );
}

/**
 * Parse a threshold input. Empty means "no threshold" (0), so clearing a box
 * widens the match rather than silently matching nothing.
 */
function parseThreshold(raw: string): number {
  const n = Number(raw);
  return raw.trim() === '' || Number.isNaN(n) ? 0 : n;
}

/**
 * Bulk rule creation drawer.
 *
 * Operates only on patterns matching the patterns page's current filters,
 * narrowed further by the three thresholds below. Nothing is created until
 * the user explicitly clicks Create — the core "no rule without approval"
 * contract holds.
 */
export function BulkRuleDrawer({ open, onOpenChange, filters }: BulkRuleDrawerProps) {
  const [minActed, setMinActed] = useState(String(DEFAULT_MIN_ACTED));
  const [minConfidence, setMinConfidence] = useState(String(DEFAULT_MIN_CONFIDENCE));
  const [minObserved, setMinObserved] = useState(String(DEFAULT_MIN_OBSERVED));
  const [action, setAction] = useState<BulkRuleAction>('delete');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Fetches only once the user has opened the drawer — never on page load.
  const { data, isLoading, isError } = useAllPatterns(
    {
      mailboxId: filters.mailboxId,
      status: filters.status,
      hasRule: filters.hasRule,
      search: filters.search,
    },
    open,
  );

  const bulkMutation = useBulkApprovePatterns();

  const matches = useMemo(() => {
    const all = data?.patterns ?? [];
    const actedFloor = parseThreshold(minActed);
    const confidenceFloor = parseThreshold(minConfidence);
    const observedFloor = parseThreshold(minObserved);

    return all
      .filter((p) => filters.patternType === 'all' || p.patternType === filters.patternType)
      // Only detected/suggested patterns can be approved into a new rule.
      .filter((p) => p.status === 'detected' || p.status === 'suggested')
      .filter((p) => !p.hasRule)
      .filter((p) => actedRate(p) >= actedFloor)
      .filter((p) => p.confidence >= confidenceFloor)
      .filter((p) => p.sampleSize >= observedFloor)
      .sort((a, b) => b.confidence - a.confidence);
  }, [data, filters.patternType, minActed, minConfidence, minObserved]);

  // Selection is always scoped to what is currently visible.
  const visibleSelectedIds = useMemo(
    () => matches.filter((p) => selected.has(p._id)).map((p) => p._id),
    [matches, selected],
  );
  const allVisibleSelected = matches.length > 0 && visibleSelectedIds.length === matches.length;

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(matches.map((p) => p._id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    if (visibleSelectedIds.length === 0) return;
    bulkMutation.mutate(
      { patternIds: visibleSelectedIds, actionType: action },
      {
        onSuccess: (result) => {
          const verb = action === 'delete' ? 'Delete' : 'Mark as read';
          if (result.created > 0) {
            toast.success(`Created ${result.created} ${verb} rule${result.created === 1 ? '' : 's'}`, {
              description:
                result.skipped || result.failed
                  ? `${result.skipped} skipped, ${result.failed} failed`
                  : undefined,
            });
          } else {
            toast.error('No rules were created', {
              description: `${result.skipped} skipped, ${result.failed} failed`,
            });
          }
          setSelected(new Set());
          if (result.created > 0 && result.failed === 0) onOpenChange(false);
        },
        onError: (err: unknown) => {
          toast.error('Bulk rule creation failed', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Bulk Rule</SheetTitle>
          <SheetDescription>
            Applies to patterns matching the page&apos;s current filters: {filters.summary}
          </SheetDescription>
        </SheetHeader>

        {/* Thresholds */}
        <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-min-acted" className="text-xs">
              Min % emails acted on
            </Label>
            <Input
              id="bulk-min-acted"
              type="number"
              min={0}
              max={100}
              value={minActed}
              onChange={(e) => setMinActed(e.target.value)}
              className="h-9 text-right tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-min-confidence" className="text-xs">
              Min % confidence
            </Label>
            <Input
              id="bulk-min-confidence"
              type="number"
              min={0}
              max={100}
              value={minConfidence}
              onChange={(e) => setMinConfidence(e.target.value)}
              className="h-9 text-right tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-min-observed" className="text-xs">
              Min emails observed
            </Label>
            <Input
              id="bulk-min-observed"
              type="number"
              min={0}
              value={minObserved}
              onChange={(e) => setMinObserved(e.target.value)}
              className="h-9 text-right tabular-nums"
            />
          </div>
        </div>

        {/* Select all + count */}
        <div className="flex items-center justify-between gap-3 border-y px-4 py-2">
          <Button variant="outline" size="sm" onClick={toggleAll} disabled={matches.length === 0}>
            {allVisibleSelected ? 'Unselect all' : 'Select all'}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {visibleSelectedIds.length} of {matches.length} selected
          </span>
        </div>

        {/* Matching patterns */}
        <div className="flex-1 overflow-y-auto px-4">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Failed to load patterns.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="w-8 py-2" />
                  <th className="py-2 text-left font-medium">Sender</th>
                  <th className="py-2 text-right font-medium">% acted</th>
                  <th className="py-2 text-right font-medium">% conf</th>
                  <th className="py-2 text-right font-medium">Observed</th>
                </tr>
              </thead>
              <tbody>
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No patterns meet these thresholds. Lower a threshold or widen the page filters.
                    </td>
                  </tr>
                ) : (
                  matches.map((p) => {
                    const rate = actedRate(p);
                    return (
                      <tr key={p._id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 align-middle">
                          <Checkbox
                            checked={selected.has(p._id)}
                            onCheckedChange={() => toggleOne(p._id)}
                            aria-label={`Select ${senderLabel(p)}`}
                          />
                        </td>
                        <td className="py-2 pr-2 align-middle">
                          <div className="truncate max-w-[260px]" title={senderLabel(p)}>
                            {senderLabel(p)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            You {ACTION_VERB[p.suggestedAction.actionType] ?? p.suggestedAction.actionType}{' '}
                            {p.sampleSize - p.exceptionCount} of {p.sampleSize}
                          </div>
                        </td>
                        <td className="py-2 text-right align-middle tabular-nums">{rate.toFixed(0)}</td>
                        <td className="py-2 text-right align-middle tabular-nums">
                          {p.confidence.toFixed(0)}
                        </td>
                        <td className="py-2 text-right align-middle tabular-nums">{p.sampleSize}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
          {data?.truncated && (
            <p className="py-2 text-xs text-muted-foreground">
              Showing the first {data.patterns.length} of {data.total} patterns matching the page
              filters. Narrow the filters to reach the rest.
            </p>
          )}
        </div>

        <SheetFooter className="gap-3 border-t">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Create rules that</span>
            <Button
              type="button"
              size="sm"
              variant={action === 'delete' ? 'default' : 'outline'}
              onClick={() => setAction('delete')}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant={action === 'markRead' ? 'default' : 'outline'}
              onClick={() => setAction('markRead')}
            >
              <MailOpen className="mr-1 h-4 w-4" />
              Mark as read
            </Button>
          </div>
          <Button
            onClick={handleCreate}
            disabled={visibleSelectedIds.length === 0 || bulkMutation.isPending}
          >
            {bulkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create {visibleSelectedIds.length} rule{visibleSelectedIds.length === 1 ? '' : 's'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
