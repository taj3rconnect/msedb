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
  sender: {
    label: 'Sender Pattern',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    tip:
      'Sender pattern — detected from how you repeatedly treat mail from one address or domain.\n' +
      'The rule it proposes matches on the sender alone, so it applies to every future email from them regardless of subject or content.',
  },
  'folder-routing': {
    label: 'Folder Routing',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    tip:
      'Folder routing — detected from you moving this sender’s mail into the same folder again and again.\n' +
      'The rule it proposes files future mail there automatically, on arrival, instead of leaving it in the Inbox for you to move.',
  },
} as const;

const STATUS_CONFIG = {
  detected: {
    label: 'Detected',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    tip:
      'Detected — the behaviour has been spotted but has not yet cleared the confidence bar to be put forward as a suggestion.\n' +
      'You can still approve it now if you already know you want it.',
  },
  suggested: {
    label: 'Suggested',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    tip:
      'Suggested — confident enough to recommend, and waiting on your decision.\n' +
      'Nothing is happening to your mailbox while it sits here. It only starts acting once you approve it.',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    tip:
      'Approved — you accepted this pattern and a mailbox rule was created from it.\n' +
      'It now acts on matching mail as it arrives. Use Unapprove below to stop it and delete the rule.',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    tip:
      'Rejected — you dismissed this suggestion, so it is in a cooldown period and will not be re-suggested until that expires.\n' +
      'Nothing in your mailbox was changed. Approving it now overrides the rejection.',
  },
  expired: {
    label: 'Expired',
    className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    tip:
      'Expired — the behaviour stopped recurring, so the suggestion aged out without a decision.\n' +
      'It is kept for reference. If the sender starts behaving the same way again, a fresh pattern will be raised.',
  },
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
          <Badge variant="outline" className={typeConfig.className} data-tip={typeConfig.tip}>
            {typeConfig.label}
          </Badge>
          <Badge variant="outline" className={statusConfig.className} data-tip={statusConfig.tip}>
            {statusConfig.label}
          </Badge>
          {/* Action pill — what this pattern's rule does. Filled once it is live,
              outlined while it is still only a proposal. */}
          <Badge
            variant="outline"
            data-tip={
              isApproved
                ? `Live action: ${actionLabel}.\nThis is what the approved rule does to every matching email as it arrives. Change it with the buttons at the bottom of this card.`
                : `Proposed action: ${actionLabel}.\nThis is what the rule would do if you approve it. Nothing happens to your mail until then — use Customize to propose a different action instead.`
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
              data-tip={
                'Rule Active — a live rule is backing this pattern and acts on mail from this sender as it arrives.\n' +
                'Click to open the Rules page filtered to this sender, where you can see how often it has fired, edit it, or delete it.'
              }
            >
              Rule Active
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          {pattern.status === 'approved' && pattern.hasRule === false && (
            <Badge
              variant="outline"
              className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              data-tip={
                'No Rule — this pattern is approved, but no live rule is backing it, so nothing is acting on the mail.\n' +
                'Either the rule was deleted from the Rules page, or creating it failed at approval time (approving never fails just because rule creation did). Use Customize to rebuild it.'
              }
            >
              No Rule
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Description */}
        <p className="text-sm font-medium">{description}</p>

        {/* Confidence bar */}
        <div
          className="space-y-1"
          data-tip={
            `${confidence}% confidence — how consistently you applied this action, weighted by how many emails were observed and how recent they are.\n` +
            'Green is 95% and above, yellow 85–94%, orange below 85%. Below roughly 85% the pattern is usually still worth a look, but expect exceptions.'
          }
        >
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
          <span data-tip={`${pattern.sampleSize} emails from this sender have been observed. The larger this number, the more the confidence score can be trusted — a 100% rate over 4 emails means far less than 95% over 200.`}>
            {pattern.sampleSize} emails observed
          </span>
          <span data-tip={`${pattern.exceptionCount} of those ${pattern.sampleSize} emails you handled differently. Exceptions are the mail a rule would get wrong, so a high count here is the main reason to reject rather than approve.`}>
            {pattern.exceptionCount} exceptions
          </span>
          {earliestEvidence && (
            <span data-tip={`The oldest observation behind this pattern is from ${new Date(earliestEvidence.timestamp).toLocaleString()}. A pattern held over a long window is more durable than the same rate compressed into a couple of days.`}>
              Since {formatRelativeTime(earliestEvidence.timestamp)}
            </span>
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
              data-tip={
                showEvidence
                  ? 'Collapse the evidence list.'
                  : `Show the ${pattern.evidence.length} individual actions this pattern was built from — what you did to each email and when.\n` +
                    'This is the raw basis for the confidence score. Worth opening when the score looks higher than your gut says it should be.'
              }
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
          <span
            className="inline-flex"
            data-tip={
              `Approve — accept this pattern and create a rule that will ${actionLabel.toLowerCase()} future mail from ${pattern.condition.senderEmail ?? pattern.condition.senderDomain ?? 'this sender'}.\n` +
              'The rule acts on mail as it arrives from now on. Emails already sitting in your mailbox are left exactly as they are — approving never runs a sweep over old mail.\n' +
              'Reversible at any time with Unapprove, which deletes the rule again.'
            }
          >
            <Button
              size="sm"
              onClick={() => onApprove(pattern._id)}
              disabled={isApproving || isRejecting}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </span>
          <span
            className="inline-flex"
            data-tip={
              'Reject — dismiss this suggestion and put the sender in a cooldown (30 days by default, changeable in Settings) so it is not suggested again.\n' +
              'If any rule already exists for this sender it is deleted too, so nothing keeps acting on their mail.\n' +
              'The pattern itself is kept, and approving it later overrides the rejection.'
            }
          >
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
          </span>
          <span
            className="inline-flex"
            data-tip={
              `Customize — approve this pattern but with a different action than the proposed ${actionLabel}.\n` +
              'Opens a dialog where you pick delete, move to a folder, archive, mark as read, flag or categorize, then approve in one step. Use it when the sender is right but the action is not.'
            }
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCustomize(pattern._id)}
              disabled={isApproving || isRejecting}
            >
              <Settings2 className="h-4 w-4 mr-1" />
              Customize
            </Button>
          </span>
          {onPreview && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreview(pattern._id)}
              aria-label="Preview recent emails"
              data-tip={
                'Preview — see the most recent emails this pattern matched before you decide.\n' +
                'Read-only: opening the preview changes nothing and marks nothing as read. This is the fastest way to check whether the exceptions are mail you would have wanted to keep.'
              }
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
              <span
                className="text-xs text-muted-foreground"
                data-tip={`This pattern is approved and its live rule currently does: ${actionLabel}. The buttons beside this switch it to something else — the old rule is deleted and a new one built.`}
              >
                Rule does:
              </span>
              <span
                className="inline-flex"
                data-tip={
                  currentAction === 'delete'
                    ? 'Already set to Delete — this is what the live rule does today, so there is nothing to change.'
                    : `Switch this rule to Delete: future mail from this sender goes straight to Deleted Items instead of being ${ACTION_LABEL[currentAction]?.toLowerCase() ?? currentAction}.\n` +
                      'You get a confirmation first. The current rule is deleted and rebuilt, so its execution count restarts; mail already handled is not touched.'
                }
              >
                <Button
                  size="sm"
                  variant={currentAction === 'delete' ? 'default' : 'outline'}
                  onClick={() => currentAction !== 'delete' && setPendingRetarget('delete')}
                  disabled={isUpdating || currentAction === 'delete'}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </span>
              <span
                className="inline-flex"
                data-tip={
                  currentAction === 'markRead'
                    ? 'Already set to Mark as read — this is what the live rule does today, so there is nothing to change.'
                    : 'Switch this rule to Mark as read: future mail from this sender stays in the Inbox but arrives already read, so it never adds to your unread count.\n' +
                      'The gentlest option — nothing is deleted or moved. You get a confirmation first, and the rule is rebuilt so its execution count restarts.'
                }
              >
                <Button
                  size="sm"
                  variant={currentAction === 'markRead' ? 'default' : 'outline'}
                  onClick={() => currentAction !== 'markRead' && setPendingRetarget('markRead')}
                  disabled={isUpdating || currentAction === 'markRead'}
                >
                  <MailOpen className="h-4 w-4 mr-1" />
                  Mark read
                </Button>
              </span>
              <span
                className="inline-flex"
                data-tip={
                  'Other — pick an action beyond the two one-click options: move to a folder, archive, flag, or categorize.\n' +
                  'Opens the same dialog as Customize, pre-filled with what this rule does today.'
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCustomize(pattern._id)}
                  disabled={isUpdating}
                >
                  <Settings2 className="h-4 w-4 mr-1" />
                  Other
                </Button>
              </span>
            </>
          )}
          {onUnapprove && (
            <span
              className="inline-flex"
              data-tip={
                'Unapprove — undo the approval and delete the live rule, so nothing keeps acting on this sender.\n' +
                'The pattern itself is kept and goes back to Suggested, so you can approve it again whenever you like. Mail the rule already handled stays as it is.\n' +
                'Use this rather than Reject if you may want the suggestion back — Reject also starts a 30-day cooldown.'
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUnapproveOpen(true)}
                disabled={isUpdating}
                className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4 mr-1" />
                )}
                Unapprove
              </Button>
            </span>
          )}
          {onPreview && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreview(pattern._id)}
              aria-label="Preview recent emails"
              data-tip={
                'Preview — see the most recent emails this rule is acting on.\n' +
                'Read-only: opening the preview changes nothing and marks nothing as read.'
              }
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
