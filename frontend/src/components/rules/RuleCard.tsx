import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { GripVertical, Loader2, Pencil, Play, Settings, Trash2, Clock, Zap, Mail } from 'lucide-react';
import { formatRelativeTime, formatNumber } from '@/lib/formatters';
import type { Rule } from '@/api/rules';

interface RuleCardProps {
  rule: Rule;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRun: (id: string) => void;
  onEdit: (rule: Rule) => void;
  isRunning?: boolean;
}

const ACTION_COLORS: Record<string, string> = {
  move: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
  delete: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  markRead: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  categorize: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
  archive: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  flag: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
};

function formatActionLabel(action: Rule['actions'][number]): string {
  switch (action.actionType) {
    case 'move':
      return `Move → ${action.toFolder ?? 'folder'}`;
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

export function RuleCard({ rule, onToggle, onDelete, onRename, onRun, onEdit, isRunning }: RuleCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(rule.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function handleSave() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== rule.name) {
      onRename(rule._id, trimmed);
    }
    setEditing(false);
  }

  function handleCancel() {
    setEditName(rule.name);
    setEditing(false);
  }

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

  const conditionCount =
    (conditions.senderEmail ? (Array.isArray(conditions.senderEmail) ? conditions.senderEmail.length : 1) : 0) +
    (conditions.senderDomain ? 1 : 0) +
    (conditions.subjectContains ? 1 : 0) +
    (conditions.bodyContains ? 1 : 0) +
    (conditions.fromFolder ? 1 : 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`group rounded-lg border bg-card transition-all ${
        isDragging ? 'opacity-50 shadow-lg ring-2 ring-primary/20' : 'hover:shadow-sm'
      } ${!rule.isEnabled ? 'opacity-50' : ''}`}
    >
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        {/* Drag handle */}
        <button
          type="button"
          className="mt-0.5 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/40 hover:text-muted-foreground shrink-0 transition-colors"
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Name row */}
          <div className="flex items-center gap-2">
            {editing ? (
              <Input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
                onBlur={handleSave}
                className="h-7 text-sm font-semibold max-w-xs"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditName(rule.name);
                  setEditing(true);
                }}
                className="flex items-center gap-1.5 group/name min-w-0"
              >
                <span className="font-semibold text-sm truncate">{rule.name}</span>
                <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover/name:opacity-60 transition-opacity" />
              </button>
            )}

            {!rule.isEnabled && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-dashed">
                Disabled
              </Badge>
            )}
          </div>

          {/* Conditions + Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Conditions */}
            {conditions.senderEmail && (
              Array.isArray(conditions.senderEmail) ? (
                conditions.senderEmail.length <= 3 ? (
                  conditions.senderEmail.map((email) => (
                    <Badge key={email} variant="outline" className="text-[11px] font-normal py-0 gap-1">
                      <Mail className="h-3 w-3" />
                      {email}
                    </Badge>
                  ))
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-[11px] font-normal py-0 gap-1 cursor-default">
                        <Mail className="h-3 w-3" />
                        {conditions.senderEmail.length} senders
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <div className="space-y-0.5 text-xs">
                        {conditions.senderEmail.map((e) => (
                          <div key={e}>{e}</div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )
              ) : (
                <Badge variant="outline" className="text-[11px] font-normal py-0 gap-1">
                  <Mail className="h-3 w-3" />
                  {conditions.senderEmail}
                </Badge>
              )
            )}
            {conditions.senderDomain && (
              <Badge variant="outline" className="text-[11px] font-normal py-0">
                @{conditions.senderDomain}
              </Badge>
            )}
            {conditions.subjectContains && (
              <Badge variant="outline" className="text-[11px] font-normal py-0">
                Subject: &quot;{conditions.subjectContains}&quot;
              </Badge>
            )}
            {conditions.bodyContains && (
              <Badge variant="outline" className="text-[11px] font-normal py-0">
                Body: &quot;{conditions.bodyContains}&quot;
              </Badge>
            )}
            {conditions.fromFolder && (
              <Badge variant="outline" className="text-[11px] font-normal py-0">
                Folder: {conditions.fromFolder}
              </Badge>
            )}

            {conditionCount > 0 && actions.length > 0 && (
              <span className="text-muted-foreground/40 text-xs">→</span>
            )}

            {/* Actions */}
            {actions.map((action, i) => (
              <Badge
                key={i}
                variant="outline"
                className={`text-[11px] font-medium py-0 ${ACTION_COLORS[action.actionType] ?? ''}`}
              >
                {formatActionLabel(action)}
              </Badge>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => onRun(rule._id)}
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run now</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(rule)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit rule</TooltipContent>
          </Tooltip>

          <Switch
            checked={rule.isEnabled}
            onCheckedChange={() => onToggle(rule._id)}
            className="mx-1"
          />

          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Delete rule</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete rule</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{rule.name}&quot;? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(rule._id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stats footer */}
      <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Zap className="h-3 w-3" />
          {formatNumber(stats.totalExecutions)} runs
        </span>
        <span className="inline-flex items-center gap-1">
          <Mail className="h-3 w-3" />
          {formatNumber(stats.emailsProcessed)} processed
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {stats.lastExecutedAt ? formatRelativeTime(stats.lastExecutedAt) : 'Never run'}
        </span>
      </div>
    </div>
  );
}
