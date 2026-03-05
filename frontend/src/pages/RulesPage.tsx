import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AlertCircle, Search, Shield, X } from 'lucide-react';
import { useMailboxes } from '@/hooks/useMailboxes';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SimulationResultPanel } from '@/components/shared/SimulationResultPanel';
import { RuleList } from '@/components/rules/RuleList';
import { RuleEditDialog } from '@/components/rules/RuleEditDialog';
import type { Rule } from '@/api/rules';
import type { SimulationResult } from '@/api/rules';
import {
  useRules,
  useToggleRule,
  useDeleteRule,
  useRenameRule,
  useRunRule,
  useReorderRules,
  useSimulateRule,
} from '@/hooks/useRules';

// Domain-based filter tags: label → email domain
const DOMAIN_TAGS = [
  { label: 'All', domain: null },
  { label: 'ApTask', domain: 'aptask.com' },
  { label: 'JobTalk', domain: 'jobtalk.ai' },
  { label: 'Yenom', domain: 'yenom.ai' },
] as const;

const PAGE_SIZE = 50;

/**
 * Rules page with drag-and-drop reordering, per-rule stats,
 * enable/disable toggles, and per-mailbox filtering.
 *
 * Replaces the ComingSoonPage placeholder at /rules.
 */
export function RulesPage() {
  const { mailboxes } = useMailboxes();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  // Simulation state
  const [simulatingRule, setSimulatingRule] = useState<Rule | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simDateRange, setSimDateRange] = useState<'30d' | '60d' | '90d'>('30d');
  const simulateMutation = useSimulateRule();

  // Debounce search input by 300ms
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Fetch all rules (no mailboxId filter — domain filtering is done client-side)
  const { data, isLoading, isError } = useRules({ search, page: 1, limit: 500 });

  // Build mailboxId → email domain map
  const mailboxDomainMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const mb of mailboxes) {
      const domain = mb.email.split('@')[1];
      if (domain) map[mb.id] = domain;
    }
    return map;
  }, [mailboxes]);

  // Filter rules by active domain tag
  const allRules = data?.rules ?? [];
  const filteredRules = useMemo(() => {
    if (!activeTag) return allRules;
    const tag = DOMAIN_TAGS.find((t) => t.label === activeTag);
    if (!tag?.domain) return allRules;
    return allRules.filter((r) => mailboxDomainMap[r.mailboxId] === tag.domain);
  }, [allRules, activeTag, mailboxDomainMap]);

  // Client-side pagination
  const totalPages = Math.ceil(filteredRules.length / PAGE_SIZE);
  const rules = filteredRules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Mutation hooks
  const toggleMutation = useToggleRule();
  const deleteMutation = useDeleteRule();
  const renameMutation = useRenameRule();
  const runMutation = useRunRule();
  const reorderMutation = useReorderRules();

  // Handlers
  const handleToggle = useCallback(
    (id: string) => {
      toggleMutation.mutate(id);
    },
    [toggleMutation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleRename = useCallback(
    (id: string, name: string) => {
      renameMutation.mutate({ id, name });
    },
    [renameMutation],
  );

  const handleRun = useCallback(
    (id: string) => {
      setRunningRuleId(id);
      runMutation.mutate(id, {
        onSuccess: (result) => {
          const parts: string[] = [];
          parts.push(`${result.matched} emails matched`);
          if (result.applied > 0) {
            parts.push(`${result.applied} processed`);
          }
          if (result.failed > 0) {
            parts.push(`${result.failed} failed`);
          }
          if (result.failed > 0) {
            toast.warning(parts.join(', '));
          } else if (result.matched === 0) {
            toast.info('No matching emails found');
          } else {
            toast.success(parts.join(', '));
          }
          setRunningRuleId(null);
        },
        onError: (err: Error) => {
          toast.error(`Run failed: ${err.message}`);
          setRunningRuleId(null);
        },
      });
    },
    [runMutation],
  );

  const handleReorder = useCallback(
    (mailboxId: string, ruleIds: string[]) => {
      reorderMutation.mutate({ mailboxId, ruleIds });
    },
    [reorderMutation],
  );

  const handleEdit = useCallback((rule: Rule) => {
    setEditingRule(rule);
  }, []);

  const handleSimulate = useCallback(
    (rule: Rule, dateRange?: '30d' | '60d' | '90d') => {
      const range = dateRange ?? simDateRange;
      setSimulatingRule(rule);
      setSimDateRange(range);
      simulateMutation.mutate(
        { ruleId: rule._id, dateRange: range },
        { onSuccess: (result) => setSimulationResult(result) },
      );
    },
    [simulateMutation, simDateRange],
  );

  const handleSimDateRangeChange = useCallback(
    (range: '30d' | '60d' | '90d') => {
      if (simulatingRule) {
        handleSimulate(simulatingRule, range);
      }
    },
    [simulatingRule, handleSimulate],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
          {!isLoading && filteredRules.length > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {filteredRules.length} {filteredRules.length === 1 ? 'rule' : 'rules'}
            </span>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by rule name, sender email, domain, or subject..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Domain filter tags */}
      <div className="flex flex-wrap items-center gap-1">
        {DOMAIN_TAGS.map((tag) => (
          <Button
            key={tag.label}
            variant={activeTag === tag.domain ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setActiveTag(tag.domain); setPage(1); }}
          >
            {tag.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load rules"
          description="There was an error loading your rules. Please try again."
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No rules yet"
          description="Approve a pattern to create your first rule, or rules will be created automatically when you approve pattern suggestions."
        />
      ) : (
        <>
          {/* Rule list with drag-and-drop */}
          <RuleList
            rules={rules}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onRename={handleRename}
            onRun={handleRun}
            onEdit={handleEdit}
            onSimulate={(rule) => handleSimulate(rule)}
            simulatingRuleId={simulateMutation.isPending ? simulatingRule?._id ?? null : null}
            runningRuleId={runningRuleId}
            onReorder={handleReorder}
          />

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
        </>
      )}

      {/* Edit rule dialog */}
      {editingRule && (
        <RuleEditDialog
          open={!!editingRule}
          onOpenChange={(open) => {
            if (!open) setEditingRule(null);
          }}
          rule={editingRule}
        />
      )}

      {/* Simulation sheet */}
      <Sheet
        open={!!simulatingRule}
        onOpenChange={(open) => {
          if (!open) {
            setSimulatingRule(null);
            setSimulationResult(null);
            setSimDateRange('30d');
          }
        }}
      >
        <SheetContent side="right" className="w-[400px] sm:w-[450px]">
          <SheetHeader>
            <SheetTitle className="truncate">
              Simulate: {simulatingRule?.name}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <SimulationResultPanel
              result={simulationResult}
              isLoading={simulateMutation.isPending}
              currentDateRange={simDateRange}
              onDateRangeChange={handleSimDateRangeChange}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
