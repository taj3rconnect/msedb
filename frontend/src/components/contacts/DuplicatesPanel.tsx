import { useState, useMemo } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Contact } from '@/api/mailboxes';
import { bulkDeleteContacts } from '@/api/mailboxes';

interface DuplicateGroup {
  reason: string;
  matchValue: string;
  contacts: Contact[];
}

function findDuplicates(contacts: Contact[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  // By email
  const emailMap = new Map<string, Contact[]>();
  for (const c of contacts) {
    for (const e of c.emailAddresses) {
      if (!e.address) continue;
      const key = e.address.toLowerCase();
      if (!emailMap.has(key)) emailMap.set(key, []);
      emailMap.get(key)!.push(c);
    }
  }
  for (const [email, dupes] of emailMap) {
    if (dupes.length > 1) {
      // Dedupe by id in case same contact has multiple emails
      const unique = [...new Map(dupes.map((c) => [c.id, c])).values()];
      if (unique.length > 1) {
        groups.push({ reason: 'Same email', matchValue: email, contacts: unique });
      }
    }
  }

  // By display name (exact match, case-insensitive)
  const nameMap = new Map<string, Contact[]>();
  for (const c of contacts) {
    if (!c.displayName) continue;
    const key = c.displayName.toLowerCase().trim();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(c);
  }
  for (const [name, dupes] of nameMap) {
    if (dupes.length > 1) {
      // Only add if not already covered by email group
      const ids = new Set(dupes.map((c) => c.id));
      const alreadyCovered = groups.some(
        (g) => g.contacts.length === dupes.length && g.contacts.every((c) => ids.has(c.id)),
      );
      if (!alreadyCovered) {
        groups.push({ reason: 'Same name', matchValue: name, contacts: dupes });
      }
    }
  }

  // By phone
  const phoneMap = new Map<string, Contact[]>();
  for (const c of contacts) {
    const allPhones = [c.mobilePhone, ...c.businessPhones].filter(Boolean);
    for (const phone of allPhones) {
      const key = phone.replace(/\D/g, '');
      if (key.length < 7) continue;
      if (!phoneMap.has(key)) phoneMap.set(key, []);
      phoneMap.get(key)!.push(c);
    }
  }
  for (const [phone, dupes] of phoneMap) {
    if (dupes.length > 1) {
      const unique = [...new Map(dupes.map((c) => [c.id, c])).values()];
      if (unique.length > 1) {
        const ids = new Set(unique.map((c) => c.id));
        const alreadyCovered = groups.some(
          (g) => g.contacts.length === unique.length && g.contacts.every((c) => ids.has(c.id)),
        );
        if (!alreadyCovered) {
          groups.push({ reason: 'Same phone', matchValue: phone, contacts: unique });
        }
      }
    }
  }

  return groups;
}

interface DuplicatesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  mailboxId: string;
  onDeleted: (deletedIds: string[]) => void;
}

export function DuplicatesPanel({ open, onOpenChange, contacts, mailboxId, onDeleted }: DuplicatesPanelProps) {
  const groups = useMemo(() => findDuplicates(contacts), [contacts]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selected);
      await bulkDeleteContacts(mailboxId, ids);
      onDeleted(ids);
      setSelected(new Set());
    } catch {
      // Error handled by apiFetch
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Duplicate Contacts</SheetTitle>
          <SheetDescription>
            {groups.length === 0
              ? 'No duplicates found.'
              : `Found ${groups.length} group${groups.length !== 1 ? 's' : ''} of potential duplicates.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-4">
          {groups.map((group, gi) => (
            <div key={gi} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">{group.reason}</span>
                <span className="text-xs text-muted-foreground truncate">{group.matchValue}</span>
              </div>
              {group.contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-1">
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleSelect(c.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {c.emailAddresses.map((e) => e.address).filter(Boolean).join(', ')}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          ))}
        </div>

        {groups.length > 0 && (
          <SheetFooter>
            <Button
              variant="destructive"
              disabled={selected.size === 0 || deleting}
              onClick={handleDelete}
              className="w-full"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Selected ({selected.size})
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
