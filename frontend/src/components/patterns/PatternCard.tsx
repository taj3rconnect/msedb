import { useState } from 'react';
import { Check, X, Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/formatters';
import type { Pattern } from '@/api/patterns';

interface PatternCardProps {
  pattern: Pattern;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCustomize: (id: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  /** When true, hides evidence and shows a more compact layout */
  condensed?: boolean;
}

const PATTERN_TYPE_CONFIG = {
  sender: { label: 'Sender Pattern', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  'folder-routing': { label: 'Folder Routing', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
} as const;

const STATUS_CONFIG = {
  detected: { label: 'Detected', className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' },
  suggested: { label: 'Suggested', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  expired: { label: 'Expired', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
} as const;

/**
 * Build a human-readable description of the pattern.
 */
function describePattern(pattern: Pattern): string {
  const { condition, suggestedAction, sampleSize } = pattern;
  const sender = condition.senderEmail ?? condition.senderDomain ?? 'unknown sender';
  const action = suggestedAction.actionType;

  if (pattern.patternType === 'sender') {
    const actionVerb =
      action === 'delete' ? 'deleted' :
      action === 'move' ? 'moved' :
      action === 'archive' ? 'archived' :
      action === 'markRead' ? 'marked as read' :
      action === 'flag' ? 'flagged' :
      action === 'categorize' ? 'categorized' : action;

    const actionCount = sampleSize - pattern.exceptionCount;
    return `You ${actionVerb} ${actionCount} of ${sampleSize} emails from ${sender}`;
  }

  // folder-routing
  const folder = suggestedAction.toFolder ?? 'a folder';
  return `You move emails from ${sender} to ${folder} (${sampleSize} observed)`;
}

/**
 * Get the CSS class for the confidence bar color.
 */
function confidenceColor(confidence: number): string {
  if (confidence >= 95) return 'bg-green-500';
  if (confidence >= 85) return 'bg-yellow-500';
  return 'bg-orange-500';
}

/**
 * Individual pattern suggestion card component.
 *
 * Displays confidence visualization, sample evidence, and
 * approve/reject/customize actions for detected or suggested patterns.
 */
export function PatternCard({
  pattern,
  onApprove,
  onReject,
  onCustomize,
  isApproving = false,
  isRejecting = false,
  condensed = false,
}: PatternCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);

  const typeConfig = PATTERN_TYPE_CONFIG[pattern.patternType];
  const statusConfig = STATUS_CONFIG[pattern.status];
  const canAct = pattern.status === 'detected' || pattern.status === 'suggested';
  const description = describePattern(pattern);
  const confidence = Math.round(pattern.confidence * 100) / 100;

  // Observation period from earliest evidence
  const earliestEvidence = pattern.evidence.length > 0
    ? pattern.evidence.reduce((earliest, e) =>
        new Date(e.timestamp) < new Date(earliest.timestamp) ? e : earliest,
      )
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={typeConfig.className}>
            {typeConfig.label}
          </Badge>
          <Badge variant="outline" className={statusConfig.className}>
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Description */}
        <p className="text-sm font-medium">{description}</p>

        {/* Confidence bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{confidence}% confidence</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className={`h-2 rounded-full transition-all ${confidenceColor(confidence)}`}
              style={{ width: `${confidence}%` }}
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{pattern.sampleSize} emails observed</span>
          <span>{pattern.exceptionCount} exceptions</span>
          {earliestEvidence && (
            <span>Since {formatRelativeTime(earliestEvidence.timestamp)}</span>
          )}
        </div>

        {/* Rejection cooldown info */}
        {pattern.status === 'rejected' && pattern.rejectionCooldownUntil && (
          <p className="text-xs text-muted-foreground">
            Cooldown until {new Date(pattern.rejectionCooldownUntil).toLocaleDateString()}
          </p>
        )}

        {/* Evidence section (collapsible, hidden in condensed mode) */}
        {!condensed && pattern.evidence.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowEvidence(!showEvidence)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showEvidence ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showEvidence ? 'Hide' : 'Show'} evidence ({pattern.evidence.length})
            </button>
            {showEvidence && (
              <div className="mt-2 space-y-1 rounded-md border p-2">
                {pattern.evidence.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[60%]">{e.action}</span>
                    <span>{formatRelativeTime(e.timestamp)}</span>
                  </div>
                ))}
                {pattern.evidence.length > 5 && (
                  <p className="text-xs text-muted-foreground/60 pt-1">
                    ...and {pattern.evidence.length - 5} more
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Action buttons */}
      {canAct && (
        <CardFooter className="flex gap-2 pt-0">
          <Button
            size="sm"
            onClick={() => onApprove(pattern._id)}
            disabled={isApproving || isRejecting}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(pattern._id)}
            disabled={isApproving || isRejecting}
            className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCustomize(pattern._id)}
            disabled={isApproving || isRejecting}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Customize
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
