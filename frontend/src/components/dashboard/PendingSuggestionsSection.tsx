import { Brain } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';

interface PendingSuggestionsSectionProps {
  suggestions?: unknown[];
}

/**
 * Pending pattern suggestions section.
 *
 * STUB: This component will be populated by Phase 5 (Pattern Intelligence).
 * For now, it renders an empty state explaining that pattern detection
 * requires observation time.
 */
export function PendingSuggestionsSection({
  suggestions = [],
}: PendingSuggestionsSectionProps) {
  if (suggestions.length === 0) {
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

  // Future: render suggestion cards when Phase 5 provides pattern data
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Suggestions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {suggestions.length} suggestion(s) pending review.
        </p>
      </CardContent>
    </Card>
  );
}
