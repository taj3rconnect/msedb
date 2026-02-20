import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Folder, FolderPlus, Loader2, Search, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { fetchMailboxFolders, createMailboxFolder } from '@/api/mailboxes';
import { fetchRules } from '@/api/rules';
import type { RuleAction, RuleConditions, Rule } from '@/api/rules';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

interface RuleActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxId: string;
  senderEmails: string[];
  subjects?: string[];
  isPending: boolean;
  onConfirm: (actions: RuleAction[], actionLabel: string, ruleName?: string, existingRuleId?: string, extraConditions?: Partial<RuleConditions>, runNow?: boolean) => void;
}

export function RuleActionsDialog({
  open,
  onOpenChange,
  mailboxId,
  senderEmails,
  subjects,
  isPending,
  onConfirm,
}: RuleActionsDialogProps) {
  const queryClient = useQueryClient();
  const allMailboxes = useAuthStore((s) => s.mailboxes).filter((m) => m.isConnected);

  const [deleteChecked, setDeleteChecked] = useState(false);
  const [moveChecked, setMoveChecked] = useState(false);
  const [markReadChecked, setMarkReadChecked] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [folderMailboxId, setFolderMailboxId] = useState(mailboxId);
  const [folderSearch, setFolderSearch] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [customName, setCustomName] = useState('');
  const [selectedExistingRuleId, setSelectedExistingRuleId] = useState('');
  const [mailboxSearchOpen, setMailboxSearchOpen] = useState(false);
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [senderDomain, setSenderDomain] = useState('');
  const [subjectContains, setSubjectContains] = useState('');
  const [bodyContains, setBodyContains] = useState('');
  const [runNow, setRunNow] = useState(true);

  // Auto-fill conditions when dialog opens
  useEffect(() => {
    if (!open) return;
    setFolderMailboxId(mailboxId);

    // Auto-fill sender domain if all senders share the same domain
    const uniqueEmails = [...new Set(senderEmails)];
    const domains = uniqueEmails.map((e) => e.split('@')[1]).filter(Boolean);
    const uniqueDomains = [...new Set(domains)];
    if (uniqueDomains.length === 1) {
      setSenderDomain(uniqueDomains[0]);
    }

    // Auto-fill subject if single email selected
    if (subjects && subjects.length === 1 && subjects[0]) {
      setSubjectContains(subjects[0]);
    }
  }, [open, mailboxId, senderEmails, subjects]);

  // Fetch folders for the selected folder mailbox
  const { data: foldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['mailbox-folders', folderMailboxId],
    queryFn: () => fetchMailboxFolders(folderMailboxId),
    enabled: open && moveChecked,
  });

  // Fetch existing rules for this mailbox
  const { data: rulesData } = useQuery({
    queryKey: ['rules', mailboxId],
    queryFn: () => fetchRules({ mailboxId, limit: 100 }),
    enabled: open,
  });

  const existingRules = rulesData?.rules ?? [];

  // When an existing rule is selected, pre-fill actions from it
  useEffect(() => {
    if (!selectedExistingRuleId) return;
    const rule = existingRules.find((r) => r._id === selectedExistingRuleId);
    if (!rule) return;

    setDeleteChecked(rule.actions.some((a) => a.actionType === 'delete'));
    setMoveChecked(rule.actions.some((a) => a.actionType === 'move'));
    setMarkReadChecked(rule.actions.some((a) => a.actionType === 'markRead'));

    const moveAction = rule.actions.find((a) => a.actionType === 'move');
    if (moveAction?.toFolder) {
      setSelectedFolder({ id: moveAction.toFolder, name: moveAction.toFolder });
    } else {
      setSelectedFolder(null);
    }
  }, [selectedExistingRuleId, existingRules]);

  // Resolve folder name when folders data loads (for existing rule pre-fill)
  useEffect(() => {
    if (!selectedFolder || !foldersData?.folders) return;
    const folder = foldersData.folders.find((f) => f.id === selectedFolder.id);
    if (folder && selectedFolder.name !== folder.displayName) {
      setSelectedFolder({ id: folder.id, name: folder.displayName });
    }
  }, [foldersData?.folders, selectedFolder]);

  const createFolderMutation = useMutation({
    mutationFn: (displayName: string) =>
      createMailboxFolder(folderMailboxId, displayName),
    onSuccess: (data) => {
      setSelectedFolder({ id: data.folder.id, name: data.folder.displayName });
      setNewFolderName('');
      setShowNewFolder(false);
      queryClient.invalidateQueries({
        queryKey: ['mailbox-folders', folderMailboxId],
      });
    },
  });

  const filteredFolders = useMemo(() => {
    if (!foldersData?.folders) return [];
    if (!folderSearch.trim()) return foldersData.folders;
    const q = folderSearch.toLowerCase();
    return foldersData.folders.filter((f) =>
      f.displayName.toLowerCase().includes(q),
    );
  }, [foldersData?.folders, folderSearch]);

  const hasSelection =
    deleteChecked || markReadChecked || (moveChecked && selectedFolder);

  const uniqueSenders = useMemo(
    () => [...new Set(senderEmails)],
    [senderEmails],
  );
  const isBulk = uniqueSenders.length > 1;

  // Generate auto name based on selected actions
  const autoName = useMemo(() => {
    const parts: string[] = [];
    if (deleteChecked) parts.push('delete');
    if (moveChecked && selectedFolder) parts.push(`move to ${selectedFolder.name}`);
    if (markReadChecked) parts.push('mark read');
    if (parts.length === 0) return '';
    const actionLabel = parts.join(' + ');
    if (isBulk) {
      return `Always ${actionLabel}`;
    }
    return `Always ${actionLabel} from ${uniqueSenders[0]}`;
  }, [deleteChecked, moveChecked, markReadChecked, selectedFolder, uniqueSenders, isBulk]);

  function handleConfirm() {
    const actions: RuleAction[] = [];
    const parts: string[] = [];

    if (deleteChecked) {
      actions.push({ actionType: 'delete' });
      parts.push('delete');
    }
    if (moveChecked && selectedFolder) {
      actions.push({ actionType: 'move', toFolder: selectedFolder.id });
      parts.push(`move to ${selectedFolder.name}`);
    }
    if (markReadChecked) {
      actions.push({ actionType: 'markRead' });
      parts.push('mark read');
    }

    const actionLabel = parts.join(' + ');
    const name = customName.trim() || undefined;
    const existingId = selectedExistingRuleId || undefined;

    const extraConditions: Partial<RuleConditions> = {};
    if (senderDomain.trim()) extraConditions.senderDomain = senderDomain.trim();
    if (subjectContains.trim()) extraConditions.subjectContains = subjectContains.trim();
    if (bodyContains.trim()) extraConditions.bodyContains = bodyContains.trim();

    onConfirm(actions, actionLabel, name, existingId, Object.keys(extraConditions).length > 0 ? extraConditions : undefined, runNow);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setDeleteChecked(false);
      setMoveChecked(false);
      setMarkReadChecked(false);
      setSelectedFolder(null);
      setFolderMailboxId(mailboxId);
      setFolderSearch('');
      setNewFolderName('');
      setShowNewFolder(false);
      setCustomName('');
      setSelectedExistingRuleId('');
      setMailboxSearch('');
      setMailboxSearchOpen(false);
      setSenderDomain('');
      setSubjectContains('');
      setBodyContains('');
      setRunNow(true);
    }
    onOpenChange(nextOpen);
  }

  function handleFolderMailboxChange(id: string) {
    setFolderMailboxId(id);
    setSelectedFolder(null);
    setFolderSearch('');
    setNewFolderName('');
    setShowNewFolder(false);
    setMailboxSearch('');
    setMailboxSearchOpen(false);
  }

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    createFolderMutation.mutate(name);
  }

  function formatRuleActions(rule: Rule): string {
    return rule.actions
      .map((a) => {
        switch (a.actionType) {
          case 'delete': return 'Delete';
          case 'move': return 'Move';
          case 'markRead': return 'Mark Read';
          case 'flag': return 'Flag';
          case 'categorize': return 'Categorize';
          case 'archive': return 'Archive';
          default: return a.actionType;
        }
      })
      .join(', ');
  }

  const showMailboxPicker = allMailboxes.length > 1;

  const filteredMailboxes = useMemo(() => {
    if (!mailboxSearch.trim()) return allMailboxes;
    const q = mailboxSearch.toLowerCase();
    return allMailboxes.filter(
      (m) =>
        (m.email?.toLowerCase().includes(q)) ||
        (m.email?.toLowerCase().includes(q)),
    );
  }, [allMailboxes, mailboxSearch]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isBulk
              ? `Create rules for ${uniqueSenders.length} senders`
              : 'Create rule for sender'}
          </DialogTitle>
        </DialogHeader>

        {isBulk ? (
          <div className="rounded-md border">
            <ScrollArea className="h-[80px]">
              <div className="p-2 space-y-0.5">
                {uniqueSenders.map((email) => (
                  <p key={email} className="text-sm text-muted-foreground truncate">
                    {email}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground truncate">
            {uniqueSenders[0]}
          </p>
        )}

        <div className="space-y-5 py-2">
          {/* Rule name */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">Rule name</Label>
            <Input
              id="rule-name"
              placeholder={autoName || 'Enter rule name...'}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="text-sm"
            />
            {!customName && autoName && (
              <p className="text-xs text-muted-foreground">
                Default: {autoName}
              </p>
            )}
          </div>

          {/* Copy from existing rule */}
          {existingRules.length > 0 && (
            <div className="space-y-1.5">
              <Label>Copy from existing rule</Label>
              <Select
                value={selectedExistingRuleId}
                onValueChange={setSelectedExistingRuleId}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select a rule..." />
                </SelectTrigger>
                <SelectContent>
                  {existingRules.map((rule) => (
                    <SelectItem key={rule._id} value={rule._id}>
                      <span className="truncate">{rule.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({formatRuleActions(rule)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Actions section header */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Delete */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="action-delete"
              checked={deleteChecked}
              onCheckedChange={(v) => setDeleteChecked(v === true)}
            />
            <Label htmlFor="action-delete">Delete always</Label>
          </div>

          {/* Move */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="action-move"
                checked={moveChecked}
                onCheckedChange={(v) => {
                  setMoveChecked(v === true);
                  if (!v) {
                    setSelectedFolder(null);
                    setFolderSearch('');
                    setNewFolderName('');
                    setShowNewFolder(false);
                  }
                }}
              />
              <Label htmlFor="action-move">
                Move always
                {selectedFolder && (
                  <span className="ml-1 text-muted-foreground">
                    &rarr; {selectedFolder.name}
                  </span>
                )}
              </Label>
            </div>

            {moveChecked && (
              <div className="ml-6 space-y-2">
                {/* Mailbox picker for folders */}
                {showMailboxPicker && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mailbox for folder</Label>
                    <Popover open={mailboxSearchOpen} onOpenChange={setMailboxSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={mailboxSearchOpen}
                          className="h-8 w-full justify-between text-sm font-normal"
                        >
                          <span className="truncate">
                            {allMailboxes.find((m) => m.id === folderMailboxId)?.email || 'Select mailbox...'}
                            {folderMailboxId === mailboxId && (
                              <span className="ml-1 text-xs text-muted-foreground">(current)</span>
                            )}
                          </span>
                          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <div className="p-2">
                          <Input
                            placeholder="Search mailbox..."
                            value={mailboxSearch}
                            onChange={(e) => setMailboxSearch(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                          />
                        </div>
                        <div className="max-h-[160px] overflow-y-auto px-1 pb-1">
                          {filteredMailboxes.length === 0 ? (
                            <p className="py-3 text-center text-sm text-muted-foreground">
                              No mailbox found
                            </p>
                          ) : (
                            filteredMailboxes.map((mb) => (
                              <Button
                                key={mb.id}
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start h-8 text-sm font-normal"
                                onClick={() => handleFolderMailboxChange(mb.id)}
                              >
                                <Check
                                  className={`mr-2 h-3.5 w-3.5 shrink-0 ${
                                    folderMailboxId === mb.id ? 'opacity-100' : 'opacity-0'
                                  }`}
                                />
                                <span className="truncate">
                                  {mb.email}
                                </span>
                                {mb.id === mailboxId && (
                                  <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                                )}
                              </Button>
                            ))
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                {/* Folder search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search folders..."
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {folderSearch && (
                    <button
                      onClick={() => setFolderSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Folder list */}
                <div className="rounded-md border">
                  {foldersLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <ScrollArea className="h-[200px]">
                      <div className="p-1 space-y-0.5">
                        {/* New folder button / inline input */}
                        {showNewFolder ? (
                          <div className="flex items-center gap-1 px-1 py-0.5">
                            <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Input
                              autoFocus
                              placeholder="Folder name"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateFolder();
                                if (e.key === 'Escape') {
                                  setShowNewFolder(false);
                                  setNewFolderName('');
                                }
                              }}
                              className="h-7 text-sm flex-1"
                              disabled={createFolderMutation.isPending}
                            />
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={handleCreateFolder}
                              disabled={
                                !newFolderName.trim() ||
                                createFolderMutation.isPending
                              }
                            >
                              {createFolderMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'Create'
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-1.5"
                              onClick={() => {
                                setShowNewFolder(false);
                                setNewFolderName('');
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-8 text-primary"
                            onClick={() => setShowNewFolder(true)}
                          >
                            <FolderPlus className="mr-2 h-3.5 w-3.5" />
                            New folder
                          </Button>
                        )}

                        {createFolderMutation.isError && (
                          <p className="px-2 text-xs text-destructive">
                            Failed to create folder
                          </p>
                        )}

                        {filteredFolders.length === 0 ? (
                          <p className="py-3 text-center text-sm text-muted-foreground">
                            No folders found
                          </p>
                        ) : (
                          filteredFolders.map((folder) => (
                            <Button
                              key={folder.id}
                              variant={
                                selectedFolder?.id === folder.id
                                  ? 'secondary'
                                  : 'ghost'
                              }
                              size="sm"
                              className="w-full justify-start h-8"
                              onClick={() =>
                                setSelectedFolder({
                                  id: folder.id,
                                  name: folder.displayName,
                                })
                              }
                            >
                              <Folder className="mr-2 h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                {folder.displayName}
                              </span>
                            </Button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mark as Read */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="action-markread"
              checked={markReadChecked}
              onCheckedChange={(v) => setMarkReadChecked(v === true)}
            />
            <Label htmlFor="action-markread">Mark as read always</Label>
          </div>

          {/* Additional conditions */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Conditions</span>
              <div className="flex-1 border-t" />
            </div>
            <div className="space-y-1.5">
              <Input
                placeholder="Sender domain (e.g. newsletter.com)"
                value={senderDomain}
                onChange={(e) => setSenderDomain(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                placeholder="Subject contains..."
                value={subjectContains}
                onChange={(e) => setSubjectContains(e.target.value)}
                className="h-8 text-sm"
              />
              <Input
                placeholder="Body contains..."
                value={bodyContains}
                onChange={(e) => setBodyContains(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-col">
          <div className="flex items-center space-x-2 self-start">
            <Checkbox
              id="action-run-now"
              checked={runNow}
              onCheckedChange={(v) => setRunNow(v === true)}
            />
            <Label htmlFor="action-run-now" className="text-sm">
              Run now on selected emails
            </Label>
          </div>
          <div className="flex justify-end gap-2 w-full">
          <Button
            onClick={handleConfirm}
            disabled={!hasSelection || isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {selectedExistingRuleId
              ? 'Update Rule'
              : isBulk
                ? `Create ${uniqueSenders.length} Rules`
                : 'Create Rule'}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
