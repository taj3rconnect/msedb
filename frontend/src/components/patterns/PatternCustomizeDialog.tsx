import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Pattern, PatternSuggestedAction } from '@/api/patterns';

interface PatternCustomizeDialogProps {
  pattern: Pattern | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (patternId: string, action: PatternSuggestedAction) => void;
  isSubmitting?: boolean;
}

const ACTION_TYPES: Array<{ value: PatternSuggestedAction['actionType']; label: string }> = [
  { value: 'delete', label: 'Delete' },
  { value: 'move', label: 'Move to folder' },
  { value: 'archive', label: 'Archive' },
  { value: 'markRead', label: 'Mark as read' },
  { value: 'flag', label: 'Flag' },
  { value: 'categorize', label: 'Categorize' },
];

/**
 * Side panel dialog for customizing a pattern's action before approval.
 *
 * Allows the user to change the action type, target folder, or category
 * before approving the pattern suggestion.
 */
export function PatternCustomizeDialog({
  pattern,
  open,
  onOpenChange,
  onConfirm,
  isSubmitting = false,
}: PatternCustomizeDialogProps) {
  const [actionType, setActionType] = useState<PatternSuggestedAction['actionType']>('delete');
  const [toFolder, setToFolder] = useState('');
  const [category, setCategory] = useState('');

  // Initialize form fields when pattern changes
  useEffect(() => {
    if (pattern) {
      setActionType(pattern.suggestedAction.actionType);
      setToFolder(pattern.suggestedAction.toFolder ?? '');
      setCategory(pattern.suggestedAction.category ?? '');
    }
  }, [pattern]);

  const handleConfirm = () => {
    if (!pattern) return;

    const action: PatternSuggestedAction = {
      actionType,
      ...(actionType === 'move' && toFolder ? { toFolder } : {}),
      ...(actionType === 'categorize' && category ? { category } : {}),
    };

    onConfirm(pattern._id, action);
  };

  const sender = pattern?.condition.senderEmail ?? pattern?.condition.senderDomain ?? 'Unknown';
  const confidence = pattern ? Math.round(pattern.confidence * 100) / 100 : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Customize Pattern Action</SheetTitle>
          <SheetDescription>
            Modify the suggested action before approving this pattern.
          </SheetDescription>
        </SheetHeader>

        {pattern && (
          <div className="flex-1 overflow-y-auto px-4 space-y-6">
            {/* Pattern details */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Sender:</span>{' '}
                <span className="font-medium">{sender}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Confidence:</span>{' '}
                <span className="font-medium">{confidence}%</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Sample size:</span>{' '}
                <span className="font-medium">{pattern.sampleSize} emails</span>
              </div>
            </div>

            {/* Action type select */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Action Type</label>
              <Select
                value={actionType}
                onValueChange={(v) => setActionType(v as PatternSuggestedAction['actionType'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((at) => (
                    <SelectItem key={at.value} value={at.value}>
                      {at.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conditional: target folder */}
            {actionType === 'move' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Target Folder</label>
                <Input
                  placeholder="e.g., Newsletters"
                  value={toFolder}
                  onChange={(e) => setToFolder(e.target.value)}
                />
              </div>
            )}

            {/* Conditional: category */}
            {actionType === 'categorize' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Input
                  placeholder="e.g., Red Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting || !pattern}>
            {isSubmitting ? 'Approving...' : 'Approve with Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
