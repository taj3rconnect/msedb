import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Trash2, Merge, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Contact } from '@/api/mailboxes';
import { bulkDeleteContacts, updateContact } from '@/api/mailboxes';

// Funny scanning messages
const SCAN_MESSAGES = [
  'Hunting for twins...',
  'Comparing fingerprints...',
  'Checking for doppelgängers...',
  'Looking under every rock...',
  'Consulting the oracle...',
  'Interrogating the address book...',
  'Spotting look-alikes...',
  'Running face recognition (just kidding)...',
  'Searching for evil twins...',
  'Checking if anyone cloned themselves...',
  'Asking contacts to form a line...',
  'Playing spot the difference...',
  'Counting heads twice...',
  'Deploying the duplicate detector 9000...',
  'Cross-referencing everything...',
  'Looking for copycats...',
  'Analyzing contact DNA...',
  'Shaking the address book upside down...',
];

interface DuplicateGroup {
  reason: string;
  matchValue: string;
  contacts: Contact[];
}

/** Score a contact by how many useful fields are filled. */
function contactScore(c: Contact): number {
  let score = 0;
  if (c.displayName?.trim()) score += 1;
  if (c.emailAddresses?.length > 0 && c.emailAddresses.some((e) => e.address)) score += c.emailAddresses.filter((e) => e.address).length;
  if (c.companyName?.trim()) score += 1;
  if (c.jobTitle?.trim()) score += 1;
  if (c.department?.trim()) score += 1;
  if (c.mobilePhone?.trim()) score += 1;
  if (c.businessPhones?.length > 0 && c.businessPhones.some(Boolean)) score += c.businessPhones.filter(Boolean).length;
  return score;
}

/** Merge fields from source into target, only filling empty fields. */
function mergeContactFields(target: Contact, source: Contact): Partial<Omit<Contact, 'id'>> {
  const updates: Partial<Omit<Contact, 'id'>> = {};

  if (!target.displayName?.trim() && source.displayName?.trim()) {
    updates.displayName = source.displayName;
  }
  if (!target.companyName?.trim() && source.companyName?.trim()) {
    updates.companyName = source.companyName;
  }
  if (!target.jobTitle?.trim() && source.jobTitle?.trim()) {
    updates.jobTitle = source.jobTitle;
  }
  if (!target.department?.trim() && source.department?.trim()) {
    updates.department = source.department;
  }
  if (!target.mobilePhone?.trim() && source.mobilePhone?.trim()) {
    updates.mobilePhone = source.mobilePhone;
  }

  // Merge emails: add any emails from source that target doesn't have
  const targetEmails = new Set(target.emailAddresses.map((e) => e.address?.toLowerCase()).filter(Boolean));
  const newEmails = source.emailAddresses.filter((e) => e.address && !targetEmails.has(e.address.toLowerCase()));
  if (newEmails.length > 0) {
    updates.emailAddresses = [...target.emailAddresses, ...newEmails];
  }

  // Merge business phones
  const targetPhones = new Set(target.businessPhones.filter(Boolean));
  const newPhones = source.businessPhones.filter((p) => p && !targetPhones.has(p));
  if (newPhones.length > 0) {
    updates.businessPhones = [...target.businessPhones, ...newPhones];
  }

  return updates;
}

/**
 * Normalize a display name for duplicate matching.
 * Strips extra whitespace, lowercases, removes special chars like quotes/asterisks.
 * Uses the full name (all parts) to avoid false positives with different middle names.
 */
function normalizeNameKey(displayName: string): string {
  if (!displayName) return '';
  // Strip common noise characters: quotes, asterisks, parentheses, brackets
  const cleaned = displayName.replace(/['"*()[\]{}<>]/g, '').trim();
  // Split on whitespace, join all parts as the key
  const parts = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.join(' ');
}

function findDuplicates(contacts: Contact[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  // Group by normalized first+last name
  const nameMap = new Map<string, Contact[]>();
  for (const c of contacts) {
    const key = normalizeNameKey(c.displayName);
    if (!key) continue; // skip contacts with no name
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(c);
  }

  for (const [name, dupes] of nameMap) {
    if (dupes.length > 1) {
      // Dedupe by contact ID (shouldn't happen, but be safe)
      const unique = [...new Map(dupes.map((c) => [c.id, c])).values()];
      if (unique.length > 1) {
        groups.push({ reason: 'Same name', matchValue: name, contacts: unique });
      }
    }
  }

  // Sort groups by number of duplicates (most first)
  groups.sort((a, b) => b.contacts.length - a.contacts.length);

  return groups;
}

type Phase = 'scanning' | 'results';

interface DuplicatesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  mailboxId: string;
  onDeleted: (deletedIds: string[]) => void;
}

export function DuplicatesPanel({ open, onOpenChange, contacts, mailboxId, onDeleted }: DuplicatesPanelProps) {
  const [phase, setPhase] = useState<Phase>('scanning');
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [scanMessage, setScanMessage] = useState(SCAN_MESSAGES[0]);
  const [elapsed, setElapsed] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<'delete' | 'merge' | null>(null);

  const cancelRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const messageRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPhase('scanning');
      setGroups([]);
      setSelected(new Set());
      setElapsed(0);
      setScannedCount(0);
      setScanMessage(SCAN_MESSAGES[0]);
      cancelRef.current = false;
      setProcessing(false);
      setProcessMessage('');
    } else {
      // Cleanup timers
      clearInterval(timerRef.current);
      clearInterval(messageRef.current);
    }
  }, [open]);

  // Run scanning phase
  useEffect(() => {
    if (!open || phase !== 'scanning') return;

    // Elapsed timer
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 100);

    // Rotating messages
    let msgIdx = 0;
    messageRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % SCAN_MESSAGES.length;
      setScanMessage(SCAN_MESSAGES[msgIdx]);
    }, 1800);

    // Simulate progressive scanning with actual work
    const runScan = () => {
      const total = contacts.length;
      let processed = 0;
      const batchSize = Math.max(50, Math.floor(total / 20));

      const processBatch = () => {
        if (cancelRef.current) {
          clearInterval(timerRef.current);
          clearInterval(messageRef.current);
          return;
        }

        processed = Math.min(processed + batchSize, total);
        setScannedCount(processed);

        if (processed >= total) {
          // Done scanning — run actual duplicate detection
          const found = findDuplicates(contacts);
          setGroups(found);
          clearInterval(timerRef.current);
          clearInterval(messageRef.current);
          setPhase('results');
        } else {
          requestAnimationFrame(processBatch);
        }
      };

      // Small delay so user sees the scanning animation
      setTimeout(processBatch, 600);
    };

    runScan();

    return () => {
      clearInterval(timerRef.current);
      clearInterval(messageRef.current);
    };
  }, [open, phase, contacts]);

  const handleCancel = () => {
    cancelRef.current = true;
    onOpenChange(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupAll = (group: DuplicateGroup, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      // Find the keeper (highest score) — never select it
      const sorted = [...group.contacts].sort((a, b) => contactScore(b) - contactScore(a));
      const keeperId = sorted[0].id;
      for (const c of group.contacts) {
        if (c.id === keeperId) continue; // never select keeper
        if (checked) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  /** Auto-select lesser contacts in all groups for deletion. */
  const autoSelectDuplicates = () => {
    const next = new Set<string>();
    for (const group of groups) {
      const sorted = [...group.contacts].sort((a, b) => contactScore(b) - contactScore(a));
      // Keep first (most info), select the rest
      for (let i = 1; i < sorted.length; i++) {
        next.add(sorted[i].id);
      }
    }
    setSelected(next);
  };

  /** Delete selected contacts, keeping unselected ones. */
  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setProcessing(true);
    setProcessMessage('Deleting duplicates...');
    try {
      const ids = Array.from(selected);
      await bulkDeleteContacts(mailboxId, ids);
      onDeleted(ids);
      // Remove deleted from groups
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          contacts: g.contacts.filter((c) => !selected.has(c.id)),
        })).filter((g) => g.contacts.length > 1)
      );
      setSelected(new Set());
      setProcessMessage(`Deleted ${ids.length} duplicate contact${ids.length !== 1 ? 's' : ''}!`);
      setTimeout(() => setProcessMessage(''), 3000);
    } catch {
      setProcessMessage('Some deletes failed. Check the error toast.');
      setTimeout(() => setProcessMessage(''), 4000);
    } finally {
      setProcessing(false);
    }
  }, [selected, mailboxId, onDeleted]);

  /** Merge selected contacts into the keeper and delete the rest. */
  const handleMerge = useCallback(async () => {
    if (selected.size === 0) return;
    setProcessing(true);
    setProcessMessage('Merging contacts...');
    try {
      const selectedIds = new Set(selected);
      let mergedCount = 0;
      let deletedIds: string[] = [];

      for (const group of groups) {
        const groupSelected = group.contacts.filter((c) => selectedIds.has(c.id));
        if (groupSelected.length === 0) continue;

        // Keeper = the one NOT selected (with most info), or the highest scoring one overall
        const sorted = [...group.contacts].sort((a, b) => contactScore(b) - contactScore(a));
        const keeper = sorted.find((c) => !selectedIds.has(c.id)) || sorted[0];

        // Merge fields from selected contacts into keeper
        let allUpdates: Partial<Omit<Contact, 'id'>> = {};
        for (const src of groupSelected) {
          if (src.id === keeper.id) continue;
          const updates = mergeContactFields(
            { ...keeper, ...allUpdates } as Contact,
            src,
          );
          allUpdates = { ...allUpdates, ...updates };
        }

        // Patch keeper if there are updates
        if (Object.keys(allUpdates).length > 0) {
          await updateContact(mailboxId, keeper.id, allUpdates);
          mergedCount++;
        }

        // Delete the selected (non-keeper) contacts
        const toDelete = groupSelected.filter((c) => c.id !== keeper.id).map((c) => c.id);
        if (toDelete.length > 0) {
          await bulkDeleteContacts(mailboxId, toDelete);
          deletedIds = [...deletedIds, ...toDelete];
        }
      }

      onDeleted(deletedIds);
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          contacts: g.contacts.filter((c) => !deletedIds.includes(c.id)),
        })).filter((g) => g.contacts.length > 1)
      );
      setSelected(new Set());
      setProcessMessage(`Merged ${mergedCount} keeper${mergedCount !== 1 ? 's' : ''}, deleted ${deletedIds.length} duplicate${deletedIds.length !== 1 ? 's' : ''}!`);
      setTimeout(() => setProcessMessage(''), 4000);
    } catch {
      setProcessMessage('Some operations failed. Check the error toast.');
      setTimeout(() => setProcessMessage(''), 4000);
    } finally {
      setProcessing(false);
    }
  }, [selected, groups, mailboxId, onDeleted]);

  const formatElapsed = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  const totalDuplicateContacts = groups.reduce((sum, g) => sum + g.contacts.length, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {phase === 'scanning' ? 'Scanning for Duplicates...' : `Duplicate Contacts (${groups.length} group${groups.length !== 1 ? 's' : ''})`}
            </DialogTitle>
          </DialogHeader>

          {/* Scanning Phase */}
          {phase === 'scanning' && (
            <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4">
              <div className="relative">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
              </div>
              <p className="text-lg font-medium text-foreground animate-pulse">
                {scanMessage}
              </p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Scanned {scannedCount.toLocaleString()} of {contacts.length.toLocaleString()} contacts</span>
                <span>·</span>
                <span>{formatElapsed(elapsed)}</span>
              </div>
              {/* Progress bar */}
              <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${contacts.length > 0 ? (scannedCount / contacts.length) * 100 : 0}%` }}
                />
              </div>
              <Button variant="outline" onClick={handleCancel} className="mt-4">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </div>
          )}

          {/* Results Phase */}
          {phase === 'results' && (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              {/* Status bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {groups.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      No duplicates found! Your contacts are squeaky clean.
                    </div>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Found {totalDuplicateContacts} contacts in {groups.length} duplicate group{groups.length !== 1 ? 's' : ''}
                    </>
                  )}
                </div>
                {groups.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={autoSelectDuplicates}
                      disabled={processing}
                    >
                      Auto-Select Duplicates
                    </Button>
                  </div>
                )}
              </div>

              {/* Process status message */}
              {processMessage && (
                <div className="text-sm text-center py-1 px-3 rounded bg-muted/50 text-muted-foreground">
                  {processMessage}
                </div>
              )}

              {/* Table */}
              {groups.length > 0 && (
                <TooltipProvider delayDuration={200}>
                <div className="flex-1 overflow-y-auto border rounded-md min-h-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="hidden md:table-cell">Company</TableHead>
                        <TableHead className="hidden lg:table-cell">Phone</TableHead>
                        <TableHead className="w-20 text-center">Fields</TableHead>
                        <TableHead className="w-20">Match</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((group) => {
                        const sorted = [...group.contacts].sort((a, b) => contactScore(b) - contactScore(a));
                        const keeperId = sorted[0].id;
                        const groupSelectedCount = group.contacts.filter((c) => c.id !== keeperId && selected.has(c.id)).length;
                        const groupSelectableCount = group.contacts.length - 1;

                        return sorted.map((contact, ci) => {
                          const isKeeper = contact.id === keeperId;
                          const score = contactScore(contact);
                          return (
                            <TableRow
                              key={contact.id}
                              className={`${isKeeper ? 'bg-green-50/50 dark:bg-green-950/20' : selected.has(contact.id) ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}
                            >
                              <TableCell className="text-center">
                                {ci === 0 && (
                                  <Checkbox
                                    checked={groupSelectedCount === groupSelectableCount && groupSelectableCount > 0}
                                    onCheckedChange={(checked) => toggleGroupAll(group, !!checked)}
                                    disabled={processing}
                                    title="Select/deselect all in group"
                                  />
                                )}
                                {ci > 0 && !isKeeper && (
                                  <Checkbox
                                    checked={selected.has(contact.id)}
                                    onCheckedChange={() => toggleSelect(contact.id)}
                                    disabled={processing}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="font-medium text-sm cursor-default border-b border-dotted border-muted-foreground/40">{contact.displayName || '(no name)'}</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="text-xs space-y-1 max-w-72">
                                      <div className="font-semibold">{contact.displayName || '(no name)'}</div>
                                      {contact.companyName && <div className="text-muted-foreground">{[contact.companyName, contact.jobTitle].filter(Boolean).join(' · ')}</div>}
                                      {contact.emailAddresses.some((e) => e.address) && (
                                        <div className="text-muted-foreground">{contact.emailAddresses.map((e) => e.address).filter(Boolean).join(', ')}</div>
                                      )}
                                      {(contact.mobilePhone || contact.businessPhones?.some(Boolean)) && (
                                        <div className="text-muted-foreground">{[contact.mobilePhone, ...contact.businessPhones].filter(Boolean).join(', ')}</div>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                  {isKeeper && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-300">
                                      KEEP
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                                {contact.emailAddresses.map((e) => e.address).filter(Boolean).join(', ') || '—'}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground truncate">
                                {contact.companyName || '—'}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground truncate">
                                {contact.mobilePhone || contact.businessPhones?.[0] || '—'}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={isKeeper ? 'default' : 'secondary'} className="text-xs">
                                  {score}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {ci === 0 && (
                                  <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                                    {group.reason}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })}
                    </TableBody>
                  </Table>
                </div>
                </TooltipProvider>
              )}

              {/* Action buttons */}
              {groups.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {selected.size > 0
                      ? `${selected.size} contact${selected.size !== 1 ? 's' : ''} selected for removal`
                      : 'Select duplicates to merge or delete'}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selected.size === 0 || processing}
                      onClick={() => setConfirmAction('merge')}
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Merge className="h-4 w-4 mr-1" />}
                      Merge & Delete ({selected.size})
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={selected.size === 0 || processing}
                      onClick={() => setConfirmAction('delete')}
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                      Delete ({selected.size})
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation dialogs */}
      <AlertDialog open={confirmAction === 'delete'} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} Duplicate Contact{selected.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected contacts from your Microsoft 365 account.
              Contacts marked as &quot;KEEP&quot; will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => { setConfirmAction(null); handleDelete(); }}
            >
              Delete {selected.size} Contact{selected.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === 'merge'} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge & Delete {selected.size} Duplicate{selected.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will merge useful information (emails, phones, company info) from the selected contacts
              into the &quot;KEEP&quot; contact in each group, then permanently delete the selected duplicates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmAction(null); handleMerge(); }}>
              Merge & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
