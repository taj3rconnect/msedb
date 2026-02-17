import { Brain, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PatternCard } from '@/components/patterns/PatternCard';
import { usePatterns, useApprovePattern, useRejectPattern } from '@/hooks/usePatterns';
import { useUiStore } from '@/stores/uiStore';

/**
 * Dashboard section showing top 3 pending pattern suggestions.
 *
 * Fetches suggested patterns from the API and renders condensed
 * PatternCard components with approve/reject actions.
 */
export function PendingSuggestionsSection() {
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const { data, isLoading, isError } = usePatterns(selectedMailboxId, 'suggested');
  const approveMutation = useApprovePattern();
  const rejectMutation = useRejectPattern();

  const patterns = data?.patterns ?? [];
  const topPatterns = patterns.slice(0, 3);
  const hasMore = patterns.length > 3 || (data?.pagination.total ?? 0) > 3;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px] rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Brain}
            title="Failed to load suggestions"
            description="There was an error loading pattern suggestions."
          />
        </CardContent>
      </Card>
    );
  }

  if (topPatterns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Brain}
            title="No Patterns Detected Yet"
            description="The system needs at least 14 days of email observation to detect patterns. Check back soon."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Pending Suggestions</CardTitle>
        {hasMore && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/patterns">
              View All
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {topPatterns.map((pattern) => (
            <PatternCard
              key={pattern._id}
              pattern={pattern}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
              onCustomize={() => {
                // Navigate to patterns page for full customize dialog
                window.location.href = '/patterns';
              }}
              isApproving={approveMutation.isPending}
              isRejecting={rejectMutation.isPending}
              condensed
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
