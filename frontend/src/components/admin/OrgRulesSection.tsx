import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgRules, useCreateOrgRule, useDeleteOrgRule } from '@/hooks/useAdmin';
import type { OrgRule } from '@/api/admin';

/**
 * Summarize rule conditions for display.
 */
function summarizeConditions(conditions: OrgRule['conditions']): string {
  const parts: string[] = [];
  if (conditions.senderEmail) parts.push(`From: ${conditions.senderEmail}`);
  if (conditions.senderDomain) parts.push(`Domain: ${conditions.senderDomain}`);
  if (conditions.subjectContains) parts.push(`Subject: "${conditions.subjectContains}"`);
  return parts.length > 0 ? parts.join(', ') : 'No conditions';
}

/**
 * Summarize rule actions for display.
 */
function summarizeActions(actions: OrgRule['actions']): string {
  return actions
    .map((a) => {
      if (a.actionType === 'move' && a.toFolder) return `Move to ${a.toFolder}`;
      return a.actionType;
    })
    .join(', ');
}

/**
 * Org-wide rules section with create dialog and rule list.
 */
export function OrgRulesSection() {
  const { data: rules, isLoading } = useOrgRules();
  const createMutation = useCreateOrgRule();
  const deleteMutation = useDeleteOrgRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(
    null,
  );

  // Create form state
  const [name, setName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderDomain, setSenderDomain] = useState('');
  const [actionType, setActionType] = useState('delete');
  const [toFolder, setToFolder] = useState('');
  const [priority, setPriority] = useState('0');

  function resetForm() {
    setName('');
    setSenderEmail('');
    setSenderDomain('');
    setActionType('delete');
    setToFolder('');
    setPriority('0');
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const conditions: Record<string, string> = {};
    if (senderEmail.trim()) conditions.senderEmail = senderEmail.trim();
    if (senderDomain.trim()) conditions.senderDomain = senderDomain.trim();

    const actions: { actionType: string; toFolder?: string }[] = [
      {
        actionType,
        ...(actionType === 'move' && toFolder.trim() ? { toFolder: toFolder.trim() } : {}),
      },
    ];

    createMutation.mutate(
      {
        name: name.trim(),
        conditions,
        actions,
        priority: Number(priority) || 0,
      },
      {
        onSuccess: () => {
          resetForm();
          setDialogOpen(false);
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[100px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Create button + dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Create Org Rule
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Create Org Rule</DialogTitle>
              <DialogDescription>
                Create a rule that applies to all users in the organization.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="rule-name">Rule Name</Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Block spam sender"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sender-email">Sender Email (optional)</Label>
                <Input
                  id="sender-email"
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="spam@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sender-domain">Sender Domain (optional)</Label>
                <Input
                  id="sender-domain"
                  value={senderDomain}
                  onChange={(e) => setSenderDomain(e.target.value)}
                  placeholder="spam-domain.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="action-type">Action</Label>
                <Select value={actionType} onValueChange={setActionType}>
                  <SelectTrigger id="action-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="move">Move</SelectItem>
                    <SelectItem value="delete">Delete</SelectItem>
                    <SelectItem value="markRead">Mark as Read</SelectItem>
                    <SelectItem value="archive">Archive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {actionType === 'move' && (
                <div className="grid gap-2">
                  <Label htmlFor="to-folder">Destination Folder</Label>
                  <Input
                    id="to-folder"
                    value={toFolder}
                    onChange={(e) => setToFolder(e.target.value)}
                    placeholder="Junk Email"
                    required
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="priority">Priority</Label>
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rules list */}
      {rules && rules.length > 0 ? (
        rules.map((rule) => (
          <Card key={rule._id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-medium">{rule.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Priority: {rule.priority}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget({ id: rule._id, name: rule.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <span className="font-medium">Conditions:</span>{' '}
                  {summarizeConditions(rule.conditions)}
                </p>
                <p>
                  <span className="font-medium">Actions:</span>{' '}
                  {summarizeActions(rule.actions)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No org-wide rules</p>
          <p className="text-sm mt-1">
            Create one to apply rules across all users.
          </p>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete org rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold">{deleteTarget?.name}</span>? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
