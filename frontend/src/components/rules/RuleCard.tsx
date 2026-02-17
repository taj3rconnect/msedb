import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GripVertical, Trash2 } from 'lucide-react';
import { formatRelativeTime, formatNumber } from '@/lib/formatters';
import type { Rule } from '@/api/rules';

interface RuleCardProps {
  rule: Rule;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

const ACTION_BADGE_STYLES: Record<string, string> = {
  move: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  delete: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  markRead: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  categorize: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  archive: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  flag: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

function formatActionLabel(action: Rule['actions'][number]): string {
  switch (action.actionType) {
    case 'move':
      return `Move to ${action.toFolder ?? 'folder'}`;
    case 'delete':
      return 'Delete';
    case 'markRead':
      return 'Mark Read';
    case 'categorize':
      return `Categorize: ${action.category ?? ''}`;
    case 'archive':
      return 'Archive';
    case 'flag':
      return 'Flag';
    default:
      return action.actionType;
  }
}

/**
 * Individual rule card with drag handle, conditions/actions display,
 * execution stats, and enable/disable toggle.
 *
 * Uses @dnd-kit/sortable for drag-and-drop reordering.
 */
export function RuleCard({ rule, onToggle, onDelete }: RuleCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const { conditions, actions, stats } = rule;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`${isDragging ? 'opacity-50 shadow-lg' : ''} ${!rule.isEnabled ? 'opacity-60' : ''}`}
    >
      <CardContent className="flex items-center gap-3 py-3 px-4">
        {/* Drag handle */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground shrink-0"
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>

        {/* Rule info */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Name */}
          <div className="font-medium text-sm truncate">{rule.name}</div>

          {/* Conditions */}
          <div className="flex flex-wrap gap-1">
            {conditions.senderEmail && (
              <Badge variant="outline" className="text-xs">
                From: {conditions.senderEmail}
              </Badge>
            )}
            {conditions.senderDomain && (
              <Badge variant="outline" className="text-xs">
                Domain: {conditions.senderDomain}
              </Badge>
            )}
            {conditions.subjectContains && (
              <Badge variant="outline" className="text-xs">
                Subject: {conditions.subjectContains}
              </Badge>
            )}
            {conditions.fromFolder && (
              <Badge variant="outline" className="text-xs">
                Folder: {conditions.fromFolder}
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-1">
            {actions.map((action, i) => (
              <Badge
                key={i}
                variant="outline"
                className={`text-xs ${ACTION_BADGE_STYLES[action.actionType] ?? ''}`}
              >
                {formatActionLabel(action)}
              </Badge>
            ))}
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{formatNumber(stats.totalExecutions)} executions</span>
            {stats.lastExecutedAt && (
              <span>Last: {formatRelativeTime(stats.lastExecutedAt)}</span>
            )}
          </div>
        </div>

        {/* Toggle switch */}
        <Switch
          checked={rule.isEnabled}
          onCheckedChange={() => onToggle(rule._id)}
          aria-label={`${rule.isEnabled ? 'Disable' : 'Enable'} rule: ${rule.name}`}
        />

        {/* Delete button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(rule._id)}
          className="text-muted-foreground hover:text-red-600 shrink-0"
          aria-label={`Delete rule: ${rule.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
