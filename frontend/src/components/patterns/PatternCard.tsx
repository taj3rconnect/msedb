import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Check,
  X,
  Settings2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Trash2,
  MailOpen,
  Undo2,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { formatRelativeTime } from '@/lib/formatters';
import type { Pattern, PatternSuggestedAction } from '@/api/patterns';

/** The two actions offered as one-click changes on an approved card. */
export type QuickAction = 'delete' | 'markRead';

interface PatternCardProps {
  pattern: Pattern;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCustomize: (id: string) => void;
  onPreview?: (id: string) => void;
  /** Re-target an approved pattern: its rule is deleted and rebuilt on this action. */
  onRetarget?: (id: string, actionType: QuickAction) => void;
  /** Undo an approval: pattern returns to Suggested and its rule is deleted. */
  onUnapprove?: (id: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  /** True while this card's own retarget/unapprove request is in flight. */
  isUpdating?: boolean;
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

const ACTION_LABEL: Record<PatternSuggestedAction['actionType'], string> = {
  delete: 'Delete',
  move: 'Move',
  archive: 'Archive',
  markRead: 'Mark read',
  flag: 'Flag',
  categorize: 'Categorize',
};

/**
 * Label for the action pill — the one thing the rule actually does, including
 * the destination folder or category when the action has one.
 */
export function actionPillLabel(action: PatternSuggestedAction): string {
  const base = ACTION_LABEL[action.actionType] ?? action.actionType;
  if (action.actionType === 'move' && action.toFolder) return `Move → ${action.toFolder}`;
  if (action.actionType === 'categorize' && action.category) return `Categorize: ${action.category}`;
  return base;
}

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
 * Displays confidence visualization, sample evidence, and the actions available
 * for the pattern's state: approve/reject/customize while it is a suggestion,
 * and change-action/unapprove once it is approved and backed by a live rule.
 */
export function PatternCard({
  pattern,
  onApprove,
  onReject,
  onCustomize,
  onPreview,
  onRetarget,
  onUnapprove,
  isApproving = false,
  isRejecting = false,
  isUpdating = false,
  condensed = false,
}: PatternCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  // Which confirmation is open: a re-target (with its action) or the unapprove.
  const [pendingRetarget, setPendingRetarget] = useState<QuickAction | null>(null);
  const [unapproveOpen, setUnapproveOpen] = useState(false);
  const navigate = useNavigate();

  const typeConfig = PATTERN_TYPE_CONFIG[pattern.patternType];
  const statusConfig = STATUS_CONFIG[pattern.status];
  const canAct = pattern.status === 'detected' || pattern.status === 'suggested';
  const isApproved = pattern.status === 'approved';
  const canEditApproved = isApproved && (onRetarget !== undefined || onUnapprove !== undefined);
  const currentAction = pattern.suggestedAction.actionType;
  const actionLabel = actionPillLabel(pattern.suggestedAction);
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
          {/* Action pill — what this pattern's rule does. Filled once it is live,
              outlined while it is still only a proposal. */}
          <Badge
            variant="outline"
            title={
              isApproved
                ? `Approved — this rule does: ${actionLabel}`
                : `Proposed action: ${actionLabel}`
            }
            className={
              isApproved
                ? 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:text-emerald-950 dark:border-emerald-500'
                : 'bg-transparent text-muted-foreground border-dashed'
            }
          >
            {actionLabel}
          </Badge>
          {pattern.hasRule === true && (
            <button
              type="button"
              onClick={() => {
                const email = pattern.condition.senderEmail ?? pattern.condition.senderDomain ?? '';
                navigate(`/rules${email ? `?search=${encodeURIComponent(email)}` : ''}`);
              }}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-800 hover:bg-green-200 dark:hover:bg-green-800 transition-colors cursor-pointer"
            >
              Rule Active
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          {pattern.status === 'approved' && pattern.hasRule === false && (
            <Badge variant="outline" className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              No Rule
            </Badge>
          )}
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

      {/* Action buttons — suggestion state */}
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
          {onPreview && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreview(pattern._id)}
              title="Preview recent emails"
              className="ml-auto"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
        </CardFooter>
      )}

      {/* Action buttons — approved state: change what the live rule does, or undo it */}
      {canEditApproved && (
        <CardFooter className="flex flex-wrap items-center gap-2 pt-0">
          {onRetarget && (
            <>
              <span className="text-xs text-muted-foreground">Rule does:</span>
              <Button
                size="sm"
                variant={currentAction === 'delete' ? 'default' : 'outline'}
                onClick={() => currentAction !== 'delete' && setPendingRetarget('delete')}
                disabled={isUpdating || currentAction === 'delete'}
                title={currentAction === 'delete' ? 'Already deleting' : 'Change this rule to Delete'}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
              <Button
                size="sm"
                variant={currentAction === 'markRead' ? 'default' : 'outline'}
                onClick={() => currentAction !== 'markRead' && setPendingRetarget('markRead')}
                disabled={isUpdating || currentAction === 'markRead'}
                title={currentAction === 'markRead' ? 'Already marking read' : 'Change this rule to Mark as read'}
              >
                <MailOpen className="h-4 w-4 mr-1" />
                Mark read
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCustomize(pattern._id)}
                disabled={isUpdating}
                title="Pick another action (move, archive, flag, categorize)"
              >
                <Settings2 className="h-4 w-4 mr-1" />
                Other
              </Button>
            </>
          )}
          {onUnapprove && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUnapproveOpen(true)}
              disabled={isUpdating}
              className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              title="Undo the approval and delete this rule"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4 mr-1" />
              )}
              Unapprove
            </Button>
          )}
          {onPreview && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreview(pattern._id)}
              title="Preview recent emails"
              className="ml-auto"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
        </CardFooter>
      )}

      {/* Confirm changing what an active rule does */}
      <AlertDialog
        open={pendingRetarget !== null}
        onOpenChange={(open) => { if (!open) setPendingRetarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change this rule to{' '}
              {pendingRetarget === 'delete' ? 'Delete' : 'Mark as read'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current <strong>{actionLabel}</strong> rule for{' '}
              {pattern.condition.senderEmail ?? pattern.condition.senderDomain ?? 'this sender'} is
              replaced by a new one. Emails already handled are not affected, and the rule&apos;s
              past execution counts start over.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRetarget && onRetarget) onRetarget(pattern._id, pendingRetarget);
                setPendingRetarget(null);
              }}
            >
              Change the rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm undoing an approval */}
      <AlertDialog open={unapproveOpen} onOpenChange={setUnapproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unapprove this pattern?</AlertDialogTitle>
            <AlertDialogDescription>
              The <strong>{actionLabel}</strong> rule for{' '}
              {pattern.condition.senderEmail ?? pattern.condition.senderDomain ?? 'this sender'} is
              deleted, so nothing keeps acting on it. The pattern itself is kept and returns to
              Suggested, so you can approve it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (onUnapprove) onUnapprove(pattern._id);
                setUnapproveOpen(false);
              }}
            >
              Unapprove and delete the rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
