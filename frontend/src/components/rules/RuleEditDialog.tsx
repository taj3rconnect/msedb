import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronsUpDown,
  FlaskConical,
  Folder,
  FolderPlus,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSimulateRule } from '@/hooks/useRules';
import type { SimulationResult } from '@/api/rules';
import { SimulationResultPanel } from '@/components/shared/SimulationResultPanel';
import { useAuthStore } from '@/stores/authStore';
import { fetchMailboxFolders, createMailboxFolder } from '@/api/mailboxes';
import { updateRule } from '@/api/rules';
import type { Rule, RuleAction } from '@/api/rules';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmailAutocomplete } from '@/components/inbox/EmailAutocomplete';
import { ClearableField } from '@/components/shared/ClearableField';

interface RuleEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: Rule;
}

export function RuleEditDialog({
  open,
  onOpenChange,
  rule,
}: RuleEditDialogProps) {
  const queryClient = useQueryClient();
  const allMailboxes = useAuthStore((s) => s.mailboxes).filter(
    (m) => m.isConnected,
  );

  const [name, setName] = useState('');
  const [deleteChecked, setDeleteChecked] = useState(false);
  const [moveChecked, setMoveChecked] = useState(false);
  const [markReadChecked, setMarkReadChecked] = useState(false);
  const [popupChecked, setPopupChecked] = useState(false);
  const [popupMessage, setPopupMessage] = useState('');
  const [forwardChecked, setForwardChecked] = useState(false);
  const [forwardTo, setForwardTo] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [folderMailboxId, setFolderMailboxId] = useState(
    rule.mailboxId ?? '',
  );
  const [folderSearch, setFolderSearch] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [mailboxSearchOpen, setMailboxSearchOpen] = useState(false);
  const [mailboxSearch, setMailboxSearch] = useState('');

  // Condition fields
  const [senderDomain, setSenderDomain] = useState('');
  const [subjectContains, setSubjectContains] = useState('');
  const [bodyContains, setBodyContains] = useState('');

  // Sender emails state (editable, multi-value)
  const [senderEmails, setSenderEmails] = useState<string[]>([]);

  // Simulation state
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simDateRange, setSimDateRange] = useState<'30d' | '60d' | '90d'>('30d');
  const simulateMutation = useSimulateRule();

  // Clear simulation when conditions change
  useEffect(() => {
    setSimulationResult(null);
  }, [senderEmails, senderDomain, subjectContains, bodyContains, forwardChecked, forwardTo]);

  // Pre-fill from rule ONCE per open. The ref guard prevents re-running on later
  // re-renders (rule is a prop object) — otherwise a field the user cleared would
  // be re-populated. Reset on close so the next open re-fills.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!open) {
      prefilledRef.current = false;
      return;
    }
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    setName(rule.name);
    setDeleteChecked(rule.actions.some((a) => a.actionType === 'delete'));
    setMoveChecked(rule.actions.some((a) => a.actionType === 'move'));
    setMarkReadChecked(rule.actions.some((a) => a.actionType === 'markRead'));
    const popupAction = rule.actions.find((a) => a.actionType === 'popup');
    setPopupChecked(!!popupAction);
    setPopupMessage(popupAction?.popupMessage ?? '');

    const forwardAction = rule.actions.find((a) => a.actionType === 'forward');
    setForwardChecked(!!forwardAction);
    setForwardTo(forwardAction?.forwardTo ?? []);

    const moveAction = rule.actions.find((a) => a.actionType === 'move');
    if (moveAction?.toFolder) {
      setSelectedFolder({ id: moveAction.toFolder, name: moveAction.toFolder });
    } else {
      setSelectedFolder(null);
    }

    setFolderMailboxId(rule.mailboxId ?? '');

    // Pre-fill condition fields
    setSenderDomain(rule.conditions.senderDomain ?? '');
    setSubjectContains(rule.conditions.subjectContains ?? '');
    setBodyContains(rule.conditions.bodyContains ?? '');

    // Pre-fill sender emails
    if (rule.conditions.senderEmail) {
      const emails = Array.isArray(rule.conditions.senderEmail)
        ? [...rule.conditions.senderEmail]
        : [rule.conditions.senderEmail];
      setSenderEmails(emails);
    } else {
      setSenderEmails([]);
    }
  }, [open, rule]);

  const { data: foldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['mailbox-folders', folderMailboxId],
    queryFn: () => fetchMailboxFolders(folderMailboxId),
    enabled: open && moveChecked && !!folderMailboxId,
  });

  // Resolve folder name when folders load
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
      setSelectedFolder({
        id: data.folder.id,
        name: data.folder.displayName,
      });
      setNewFolderName('');
      setShowNewFolder(false);
      queryClient.invalidateQueries({
        queryKey: ['mailbox-folders', folderMailboxId],
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const actions: RuleAction[] = [];
      if (deleteChecked) {
        actions.push({ actionType: 'delete' });
      }
      if (moveChecked && selectedFolder) {
        actions.push({ actionType: 'move', toFolder: selectedFolder.id });
      }
      if (markReadChecked) {
        actions.push({ actionType: 'markRead' });
      }
      if (popupChecked) {
        actions.push({ actionType: 'popup', popupMessage: popupMessage.trim() || 'Rule triggered' });
      }
      if (forwardChecked && forwardTo.length > 0) {
        actions.push({ actionType: 'forward', forwardTo });
      }

      const conditions = { ...rule.conditions };
      if (senderEmails.length === 0) {
        delete conditions.senderEmail;
      } else if (senderEmails.length === 1) {
        conditions.senderEmail = senderEmails[0];
      } else {
        conditions.senderEmail = senderEmails;
      }

      // Update text-based conditions
      conditions.senderDomain = senderDomain.trim() || undefined;
      conditions.subjectContains = subjectContains.trim() || undefined;
      conditions.bodyContains = bodyContains.trim() || undefined;

      return updateRule(rule._id, {
        name: name.trim() || rule.name,
        conditions,
        actions,
      });
    },
    onSuccess: () => {
      toast.success('Rule updated');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update: ${err.message}`);
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

  const filteredMailboxes = useMemo(() => {
    if (!mailboxSearch.trim()) return allMailboxes;
    const q = mailboxSearch.toLowerCase();
    return allMailboxes.filter(
      (m) =>
        m.email?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q),
    );
  }, [allMailboxes, mailboxSearch]);

  const hasActions =
    deleteChecked ||
    markReadChecked ||
    (moveChecked && selectedFolder) ||
    popupChecked ||
    (forwardChecked && forwardTo.length > 0);

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
    const folderName = newFolderName.trim();
    if (!folderName) return;
    createFolderMutation.mutate(folderName);
  }

  function handleSimulate(dateRange?: '30d' | '60d' | '90d') {
    const range = dateRange ?? simDateRange;
    setSimDateRange(range);

    if (!rule.mailboxId) return;

    const conditions: Record<string, unknown> = {};
    if (senderEmails.length === 1) conditions.senderEmail = senderEmails[0];
    else if (senderEmails.length > 1) conditions.senderEmail = senderEmails;
    if (senderDomain.trim()) conditions.senderDomain = senderDomain.trim();
    if (subjectContains.trim()) conditions.subjectContains = subjectContains.trim();
    if (bodyContains.trim()) conditions.bodyContains = bodyContains.trim();

    if (Object.keys(conditions).length === 0) return;

    simulateMutation.mutate(
      { mailboxId: rule.mailboxId, conditions, dateRange: range },
      { onSuccess: (result) => setSimulationResult(result) },
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setFolderSearch('');
      setNewFolderName('');
      setShowNewFolder(false);
      setMailboxSearch('');
      setMailboxSearchOpen(false);
      setSimulationResult(null);
      setSimDateRange('30d');
      setPopupChecked(false);
      setPopupMessage('');
      setForwardChecked(false);
      setForwardTo([]);
    }
    onOpenChange(nextOpen);
  }

  const showMailboxPicker = allMailboxes.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Rule name */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-rule-name">Rule name</Label>
            <Input
              id="edit-rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Two-column layout: Actions (left) | Conditions (right) */}
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 md:gap-6">

          {/* ===== Actions column ===== */}
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</span>
              <div className="flex-1 border-t" />
            </div>

            {/* Delete */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-action-delete"
                checked={deleteChecked}
                onCheckedChange={(v) => setDeleteChecked(v === true)}
              />
              <Label htmlFor="edit-action-delete">Delete always</Label>
            </div>

            {/* Move */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-action-move"
                  checked={moveChecked}
                  onCheckedChange={(v) => {
                    setMoveChecked(v === true);
                    if (!v) {
                      setSelectedFolder(null);
                      setFolderSearch('');
                    }
                  }}
                />
                <Label htmlFor="edit-action-move">
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
                  {/* Mailbox picker */}
                  {showMailboxPicker && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Mailbox for folder
                      </Label>
                      <Popover
                        open={mailboxSearchOpen}
                        onOpenChange={setMailboxSearchOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={mailboxSearchOpen}
                            className="h-8 w-full justify-between text-sm font-normal"
                          >
                            <span className="truncate">
                              {allMailboxes.find(
                                (m) => m.id === folderMailboxId,
                              )?.email || 'Select mailbox...'}
                            </span>
                            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] p-0"
                          align="start"
                        >
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
                                  onClick={() =>
                                    handleFolderMailboxChange(mb.id)
                                  }
                                >
                                  <Check
                                    className={`mr-2 h-3.5 w-3.5 shrink-0 ${
                                      folderMailboxId === mb.id
                                        ? 'opacity-100'
                                        : 'opacity-0'
                                    }`}
                                  />
                                  <span className="truncate">
                                    {mb.email}
                                  </span>
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
                          {showNewFolder ? (
                            <div className="flex items-center gap-1 px-1 py-0.5">
                              <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <Input
                                autoFocus
                                placeholder="Folder name"
                                value={newFolderName}
                                onChange={(e) =>
                                  setNewFolderName(e.target.value)
                                }
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
                id="edit-action-markread"
                checked={markReadChecked}
                onCheckedChange={(v) => setMarkReadChecked(v === true)}
              />
              <Label htmlFor="edit-action-markread">Mark as read always</Label>
            </div>

            {/* Popup Window */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-action-popup"
                  checked={popupChecked}
                  onCheckedChange={(v) => setPopupChecked(v === true)}
                />
                <Label htmlFor="edit-action-popup">Show popup window</Label>
              </div>
              {popupChecked && (
                <div className="ml-6">
                  <Input
                    autoFocus
                    placeholder="Popup message (e.g. Message from Boss)"
                    value={popupMessage}
                    onChange={(e) => setPopupMessage(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>
            {/* Forward */}
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-action-forward"
                  checked={forwardChecked}
                  onCheckedChange={(v) => {
                    setForwardChecked(v === true);
                    if (!v) setForwardTo([]);
                  }}
                />
                <Label htmlFor="edit-action-forward">
                  Forward
                  {forwardChecked && forwardTo.length > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      &rarr; {forwardTo.length} recipient{forwardTo.length > 1 ? 's' : ''}
                    </span>
                  )}
                </Label>
              </div>
              {forwardChecked && (
                <div className="ml-6 space-y-1">
                  <EmailAutocomplete
                    value={forwardTo}
                    onChange={setForwardTo}
                    placeholder="Search contacts or type an email…"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Matching emails are forwarded to {forwardTo.length > 0 ? 'these recipients' : 'the recipients you add'}.
                  </p>
                </div>
              )}
            </div>
          </div>{/* end Actions column */}

          {/* ===== Conditions column ===== */}
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conditions</span>
              <div className="flex-1 border-t" />
            </div>

            {/* Email From — multi-value with contact typeahead */}
            <div className="space-y-1">
              <Label htmlFor="edit-cond-email-from" className="text-xs text-muted-foreground">Email From</Label>
              <EmailAutocomplete
                id="edit-cond-email-from"
                value={senderEmails}
                onChange={setSenderEmails}
                placeholder="Search contacts or type an email…"
              />
            </div>

            <ClearableField
              id="edit-cond-domain-from"
              label="Domain From"
              placeholder="Sender domain (e.g. newsletter.com)"
              value={senderDomain}
              onChange={setSenderDomain}
            />
            <ClearableField
              id="edit-cond-subject"
              label="Subject Line"
              placeholder="Subject contains..."
              value={subjectContains}
              onChange={setSubjectContains}
            />
            <ClearableField
              id="edit-cond-body"
              label="MSG Body Text"
              placeholder="Body contains..."
              value={bodyContains}
              onChange={setBodyContains}
            />
          </div>{/* end Conditions column */}

          </div>{/* end two-column grid */}
        </div>

        {/* Simulation results */}
        {(simulationResult || simulateMutation.isPending) && (
          <SimulationResultPanel
            result={simulationResult}
            isLoading={simulateMutation.isPending}
            currentDateRange={simDateRange}
            onDateRangeChange={(range) => handleSimulate(range)}
          />
        )}

        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleSimulate()}
            disabled={simulateMutation.isPending}
            className="text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:hover:bg-amber-950/50"
          >
            {simulateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-4 w-4" />
            )}
            Simulate
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!hasActions || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
