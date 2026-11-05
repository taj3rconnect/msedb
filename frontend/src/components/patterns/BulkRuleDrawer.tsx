import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Trash2, MailOpen, BellOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { useAllPatterns, useBulkApprovePatterns, useBulkSuppressPatterns } from '@/hooks/usePatterns';
import type { BulkRuleAction, Pattern, SuppressScope } from '@/api/patterns';

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
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressScope, setSuppressScope] = useState<SuppressScope>('sender');

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
  const suppressMutation = useBulkSuppressPatterns();

  const matches = useMemo(() => {
    const all = data?.patterns ?? [];
    const actedFloor = parseThreshold(minActed);
    const confidenceFloor = parseThreshold(minConfidence);
    const observedFloor = parseThreshold(minObserved);

    // Every status is listed — the per-row Outcome column says what the chosen
    // action will do to each one, so approved senders can be re-targeted here too.
    return all
      .filter((p) => filters.patternType === 'all' || p.patternType === filters.patternType)
      .filter((p) => actedRate(p) >= actedFloor)
      .filter((p) => p.confidence >= confidenceFloor)
      .filter((p) => p.sampleSize >= observedFloor)
      .sort((a, b) => b.confidence - a.confidence);
  }, [data, filters.patternType, minActed, minConfidence, minObserved]);

  /** What clicking Apply will do to this row, given the currently chosen action. */
  const outcomeFor = useCallback(
    (p: Pattern): { label: string; muted: boolean } => {
      if (p.status === 'approved') {
        return p.suggestedAction.actionType === action
          ? { label: 'No change', muted: true }
          : { label: 'Rule replaced', muted: false };
      }
      if (p.status === 'rejected' || p.status === 'expired') {
        return { label: 'Re-approved', muted: false };
      }
      return { label: 'New rule', muted: false };
    },
    [action],
  );

  // Rows that would do nothing are worth calling out before the click, not after.
  const noChangeCount = useMemo(
    () => matches.filter((p) => selected.has(p._id) && outcomeFor(p).muted).length,
    [matches, selected, outcomeFor],
  );

  // Silencing an approved sender leaves its rule in place but inert — say so.
  const approvedSelectedCount = useMemo(
    () => matches.filter((p) => selected.has(p._id) && p.status === 'approved').length,
    [matches, selected],
  );

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

  // The exact values that will be silenced — shown in the confirm dialog so the
  // user sees what they are committing to, not just a count.
  const suppressTargets = useMemo(() => {
    const values = matches
      .filter((p) => selected.has(p._id))
      .map((p) => {
        const email = p.condition.senderEmail;
        const domain = p.condition.senderDomain;
        return suppressScope === 'domain'
          ? (domain ?? email?.split('@')[1])
          : (email ?? domain);
      })
      .filter((v): v is string => Boolean(v))
      .map((v) => v.toLowerCase());
    return [...new Set(values)];
  }, [matches, selected, suppressScope]);

  function handleSuppress() {
    if (visibleSelectedIds.length === 0) return;
    suppressMutation.mutate(
      { patternIds: visibleSelectedIds, scope: suppressScope },
      {
        onSuccess: (result) => {
          toast.success(
            `Silenced ${result.suppressed} ${suppressScope === 'domain' ? 'domain' : 'sender'}${result.suppressed === 1 ? '' : 's'}`,
            { description: 'No new patterns will be suggested for them. Undo in Settings → Whitelist.' },
          );
          setSelected(new Set());
          setSuppressOpen(false);
        },
        onError: (err: unknown) => {
          toast.error('Could not silence these senders', {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  function handleCreate() {
    if (visibleSelectedIds.length === 0) return;
    bulkMutation.mutate(
      { patternIds: visibleSelectedIds, actionType: action },
      {
        onSuccess: (result) => {
          const verb = action === 'delete' ? 'Delete' : 'Mark as read';
          const touched = result.created + result.updated;
          const detail = [
            result.created ? `${result.created} created` : null,
            result.updated ? `${result.updated} replaced` : null,
            result.skipped ? `${result.skipped} skipped` : null,
            result.failed ? `${result.failed} failed` : null,
          ]
            .filter(Boolean)
            .join(', ');

          if (touched > 0) {
            toast.success(`${touched} ${verb} rule${touched === 1 ? '' : 's'} applied`, {
              description: detail,
            });
          } else {
            toast.error('No rules changed', { description: detail });
          }
          setSelected(new Set());
          if (touched > 0 && result.failed === 0) onOpenChange(false);
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
            Applies to patterns matching the page&apos;s current filters: {filters.summary}. Approved
            senders are included — picking an action rebuilds their rule.
          </SheetDescription>
        </SheetHeader>

        {/* Thresholds */}
        <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-3">
          <div
            className="space-y-1.5"
            data-tip={
              'Minimum share of a sender’s observed emails on which you actually took the action, as a percentage.\n' +
              'At 90 a sender you handled 9 out of 10 times qualifies; one you handled 8 of 10 does not. This is the threshold that keeps senders you treat inconsistently out of a bulk rule.\n' +
              'Clear the box to drop the threshold entirely.'
            }
          >
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
          <div
            className="space-y-1.5"
            data-tip={
              'Minimum confidence score a pattern must carry to be listed, as a percentage.\n' +
              'Confidence blends how consistent the behaviour is with how much of it was seen and how recent it is — so it is stricter than acted-% alone. 85 is a safe floor; below about 70 expect exceptions.'
            }
          >
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
          <div
            className="space-y-1.5"
            data-tip={
              'Minimum number of emails seen from a sender before they can appear here.\n' +
              'This is the guard against small-sample flukes: 100% acted-on over 3 emails is not evidence of a habit. At 10 a sender needs a real history before a bulk rule can touch them.'
            }
          >
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
          <span
            className="inline-flex"
            data-tip={
              matches.length === 0
                ? 'Nothing to select — no pattern meets these thresholds. Lower one of the three numbers above, or widen the filters on the patterns page.'
                : allVisibleSelected
                  ? `Clear the selection — all ${matches.length} listed patterns are currently ticked.`
                  : `Tick all ${matches.length} patterns in this list.\n` +
                    'Selection can only ever cover what is listed here, so a pattern excluded by the thresholds or the page filters can never be caught by a bulk action.'
            }
          >
            <Button variant="outline" size="sm" onClick={toggleAll} disabled={matches.length === 0}>
              {allVisibleSelected ? 'Unselect all' : 'Select all'}
            </Button>
          </span>
          <span
            className="text-sm text-muted-foreground tabular-nums"
            data-tip={`${visibleSelectedIds.length} of the ${matches.length} listed patterns are ticked. Only these are affected when you click Apply — the Outcome column says what happens to each one.`}
          >
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
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Outcome</th>
                  <th className="py-2 text-right font-medium">% acted</th>
                  <th className="py-2 text-right font-medium">% conf</th>
                  <th className="py-2 text-right font-medium">Observed</th>
                </tr>
              </thead>
              <tbody>
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No patterns meet these thresholds. Lower a threshold or widen the page filters.
                    </td>
                  </tr>
                ) : (
                  matches.map((p) => {
                    const rate = actedRate(p);
                    const outcome = outcomeFor(p);
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
                          <div className="truncate max-w-[260px]" data-tip={senderLabel(p)}>
                            {senderLabel(p)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            You {ACTION_VERB[p.suggestedAction.actionType] ?? p.suggestedAction.actionType}{' '}
                            {p.sampleSize - p.exceptionCount} of {p.sampleSize}
                          </div>
                        </td>
                        <td className="py-2 pr-2 align-middle">
                          <span className="text-xs capitalize text-muted-foreground">
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2 pr-2 align-middle">
                          <span
                            className={`text-xs ${outcome.muted ? 'text-muted-foreground/60' : 'font-medium'}`}
                          >
                            {outcome.label}
                          </span>
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
            <span
              className="text-sm text-muted-foreground"
              data-tip="Pick the one action every selected pattern's rule will perform. Changing it re-computes the Outcome column, so you can see what it does to each row before applying."
            >
              Make these rules
            </span>
            <Button
              type="button"
              size="sm"
              variant={action === 'delete' ? 'default' : 'outline'}
              onClick={() => setAction('delete')}
              data-tip={
                'Delete — future mail from every selected sender goes straight to Deleted Items.\n' +
                'The most aggressive option here. Mail already in your mailbox is untouched; only new arrivals are affected.'
              }
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant={action === 'markRead' ? 'default' : 'outline'}
              onClick={() => setAction('markRead')}
              data-tip={
                'Mark as read — future mail from every selected sender stays in the Inbox but arrives already read.\n' +
                'Nothing is deleted or moved, so this is the safe choice when you are applying a rule to many senders at once.'
              }
            >
              <MailOpen className="mr-1 h-4 w-4" />
              Mark as read
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex"
              data-tip={
                visibleSelectedIds.length === 0
                  ? 'Tick some patterns first — this acts on the selection.'
                  : `Never suggest — add the ${visibleSelectedIds.length} selected sender${visibleSelectedIds.length === 1 ? '' : 's'} to this mailbox’s whitelist so pattern analysis stops looking at them entirely.\n` +
                    'No rule is created. Existing rules are not deleted but stop firing while the sender is silenced.\n' +
                    'You confirm on the next screen, where you also choose the exact address or the whole domain. Reversible in Settings → Whitelist.'
              }
            >
              <Button
                variant="outline"
                onClick={() => setSuppressOpen(true)}
                disabled={visibleSelectedIds.length === 0 || suppressMutation.isPending}
              >
                {suppressMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <BellOff className="mr-1 h-4 w-4" />
                Never suggest
              </Button>
            </span>
            <span
              className="inline-flex"
              data-tip={
                visibleSelectedIds.length === 0
                  ? 'Tick some patterns first — nothing is selected, so there is nothing to apply.'
                  : `Create or replace rules for the ${visibleSelectedIds.length} selected pattern${visibleSelectedIds.length === 1 ? '' : 's'}, all doing ${action === 'delete' ? 'Delete' : 'Mark as read'}.\n` +
                    'Per the Outcome column: unapproved patterns get a new rule, already-approved ones have their rule deleted and rebuilt, rejected or expired ones are re-approved and their cooldown cleared.' +
                    (noChangeCount
                      ? `\n${noChangeCount} of your selection ${noChangeCount === 1 ? 'is' : 'are'} already set to this action and will be left alone.`
                      : '')
              }
            >
              <Button
                onClick={handleCreate}
                disabled={visibleSelectedIds.length === 0 || bulkMutation.isPending}
              >
                {bulkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Apply to {visibleSelectedIds.length} pattern{visibleSelectedIds.length === 1 ? '' : 's'}
                {noChangeCount > 0 && ` (${noChangeCount} unchanged)`}
              </Button>
            </span>
          </div>
        </SheetFooter>

        {/* Confirm permanent suppression */}
        <AlertDialog open={suppressOpen} onOpenChange={setSuppressOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Never suggest rules for {suppressTargets.length}{' '}
                {suppressScope === 'domain' ? 'domain' : 'sender'}
                {suppressTargets.length === 1 ? '' : 's'}?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    These are added to this mailbox&apos;s whitelist. Pattern analysis will stop
                    detecting them, so they never appear as a suggestion again. Existing rules are
                    not deleted — they simply stop firing. Reversible in Settings → Whitelist.
                  </p>
                  {approvedSelectedCount > 0 && (
                    <p className="text-muted-foreground">
                      {approvedSelectedCount} of these {approvedSelectedCount === 1 ? 'is' : 'are'}{' '}
                      approved with a live rule. Those rules stay in place but stop acting while the
                      sender is silenced — use <strong>Unapprove</strong> on the card to remove them.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Silence the</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={suppressScope === 'sender' ? 'default' : 'outline'}
                      onClick={() => setSuppressScope('sender')}
                      data-tip="Silence only these exact addresses. Other people at the same company still get analysed as normal. The narrower, safer choice."
                    >
                      exact address
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={suppressScope === 'domain' ? 'default' : 'outline'}
                      onClick={() => setSuppressScope('domain')}
                      data-tip={
                        'Silence every address at these domains, including senders you have never seen yet.\n' +
                        'Far broader than it looks — silencing a domain you also get real mail from means no pattern will ever be suggested for that colleague or client.'
                      }
                    >
                      whole domain
                    </Button>
                  </div>
                  <ul className="max-h-40 overflow-y-auto rounded-md border p-2 text-sm">
                    {suppressTargets.map((v) => (
                      <li key={v} className="truncate py-0.5">
                        {v}
                      </li>
                    ))}
                  </ul>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSuppress} disabled={suppressMutation.isPending}>
                Never suggest these
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
