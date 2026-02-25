import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Contact as ContactIcon, Search, X, Loader2, Download, Upload,
  Users, ChevronDown, LayoutGrid,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSettings } from '@/hooks/useSettings';
import { fetchAllContacts, deleteContact, type Contact } from '@/api/mailboxes';
import { ContactCard } from '@/components/contacts/ContactCard';
import { ContactDetailDialog } from '@/components/contacts/ContactDetailDialog';
import { AlphabetIndex } from '@/components/contacts/AlphabetIndex';
import { DuplicatesPanel } from '@/components/contacts/DuplicatesPanel';
import { ImportDialog } from '@/components/contacts/ImportDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/** Get the letter group key for a contact name. */
function getLetterKey(name: string): string {
  if (!name) return '#';
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/** Generate CSV from contacts. */
function exportCSV(contacts: Contact[]): string {
  const headers = ['Display Name', 'Email', 'Email 2', 'Company', 'Job Title', 'Department', 'Mobile Phone', 'Business Phone'];
  const rows = contacts.map((c) => {
    const emails = c.emailAddresses.map((e) => e.address).filter(Boolean);
    const phones = c.businessPhones.filter(Boolean);
    return [
      c.displayName,
      emails[0] || '',
      emails[1] || '',
      c.companyName,
      c.jobTitle,
      c.department,
      c.mobilePhone,
      phones[0] || '',
    ].map((v) => `"${(v || '').replace(/"/g, '""')}"`).join(',');
  });
  return [headers.join(','), ...rows].join('\r\n');
}

/** Generate vCard from contacts. */
function exportVCard(contacts: Contact[]): string {
  return contacts.map((c) => {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push(`FN:${c.displayName}`);
    const parts = c.displayName.split(/\s+/);
    lines.push(`N:${parts.slice(1).join(' ') || ''};${parts[0] || ''};;;`);
    for (const e of c.emailAddresses) {
      if (e.address) lines.push(`EMAIL;TYPE=INTERNET:${e.address}`);
    }
    if (c.companyName) lines.push(`ORG:${c.companyName}`);
    if (c.jobTitle) lines.push(`TITLE:${c.jobTitle}`);
    if (c.mobilePhone) lines.push(`TEL;TYPE=CELL:${c.mobilePhone}`);
    for (const p of c.businessPhones) {
      if (p) lines.push(`TEL;TYPE=WORK:${p}`);
    }
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }).join('\r\n');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ContactsPage() {
  const { data: settingsData, isLoading: settingsLoading } = useSettings();
  const contactsMailboxId = settingsData?.user.preferences.contactsMailboxId;
  const contactsFolderId = settingsData?.user.preferences.contactsFolderId;

  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeLetter, setActiveLetter] = useState('');
  const [columnsPerRow, setColumnsPerRow] = useState(() => {
    const saved = localStorage.getItem('contacts-columns');
    return saved ? parseInt(saved, 10) : 4;
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // / key focuses search (same as InboxPage)
  useKeyboardShortcuts(useMemo(() => [
    { key: '/', action: () => { inputRef.current?.focus(); } },
    { key: 'Escape', action: () => {
      if (query) setQuery('');
      else inputRef.current?.blur();
    }},
  ], [query]));

  // Load all contacts on mount
  const loadContacts = useCallback(async () => {
    if (!contactsMailboxId || !contactsFolderId) return;
    setLoading(true);
    try {
      const { contacts } = await fetchAllContacts(contactsMailboxId, contactsFolderId);
      setAllContacts(contacts);
    } catch {
      setAllContacts([]);
    } finally {
      setLoading(false);
    }
  }, [contactsMailboxId, contactsFolderId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Client-side filtered + grouped contacts
  const filtered = useMemo(() => {
    if (!query.trim()) return allContacts;
    const q = query.toLowerCase();
    return allContacts.filter((c) =>
      c.displayName.toLowerCase().includes(q) ||
      c.emailAddresses.some((e) => e.address?.toLowerCase().includes(q)) ||
      c.companyName.toLowerCase().includes(q) ||
      c.jobTitle.toLowerCase().includes(q) ||
      c.department.toLowerCase().includes(q) ||
      c.mobilePhone.includes(q) ||
      c.businessPhones.some((p) => p.includes(q)),
    );
  }, [allContacts, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const letter = getLetterKey(c.displayName);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    // Sort keys: A-Z then #
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filtered]);

  const availableLetters = useMemo(() => new Set(grouped.map(([letter]) => letter)), [grouped]);

  // Scroll to letter section
  const scrollToLetter = (letter: string) => {
    const el = sectionRefs.current.get(letter);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveLetter(letter);
    }
  };

  // Track active letter on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let current = '';
      for (const [letter, el] of sectionRefs.current) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerTop <= 40) {
          current = letter;
        }
      }
      if (current) setActiveLetter(current);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [grouped]);

  // Selection
  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Card click → edit
  const handleCardClick = (contact: Contact) => {
    setEditContact(contact);
    setEditOpen(true);
  };

  // Quick delete from card
  const handleQuickDelete = async (contact: Contact) => {
    if (!contactsMailboxId) return;
    try {
      await deleteContact(contactsMailboxId, contact.id);
      setAllContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch {
      // Error handled by apiFetch
    }
  };

  // After edit save
  const handleUpdated = (updated: Contact) => {
    setAllContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  // After single delete from dialog
  const handleDeleted = (id: string) => {
    setAllContacts((prev) => prev.filter((c) => c.id !== id));
  };

  // After bulk delete from duplicates panel
  const handleBulkDeleted = (ids: string[]) => {
    const idSet = new Set(ids);
    setAllContacts((prev) => prev.filter((c) => !idSet.has(c.id)));
  };

  // Export
  const handleExportCSV = () => {
    const csv = exportCSV(filtered);
    downloadFile(csv, 'contacts.csv', 'text/csv');
  };
  const handleExportVCard = () => {
    const vcf = exportVCard(filtered);
    downloadFile(vcf, 'contacts.vcf', 'text/vcard');
  };

  const handleColumnsChange = (cols: number) => {
    setColumnsPerRow(cols);
    localStorage.setItem('contacts-columns', String(cols));
  };

  const gridStyle = { gridTemplateColumns: `repeat(${columnsPerRow}, minmax(0, 1fr))` };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contactsMailboxId || !contactsFolderId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground">Search your Microsoft 365 contacts</p>
        </div>
        <EmptyState
          icon={ContactIcon}
          title="No contact folder configured"
          description="Go to Settings &rarr; Contacts to select a mailbox and contact folder."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] overflow-hidden">
      {/* Header + toolbar */}
      <div className="shrink-0 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            {!loading && (
              <p className="text-muted-foreground text-sm">
                {filtered.length === allContacts.length
                  ? `${allContacts.length} contacts`
                  : `${filtered.length} of ${allContacts.length} contacts`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <LayoutGrid className="h-4 w-4" /> {columnsPerRow}/row <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <DropdownMenuItem key={n} onClick={() => handleColumnsChange(n)}>
                    {n} per row {n === columnsPerRow ? '\u2713' : ''}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => setDuplicatesOpen(true)}>
              <Users className="h-4 w-4" /> Duplicates
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" /> Export <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCSV}>Export as CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportVCard}>Export as vCard</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search by name, email, company, phone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main content: alphabet index + card grid */}
      <div className="flex-1 flex gap-1 overflow-hidden min-h-0">
        {/* Alphabet index */}
        {!loading && filtered.length > 0 && (
          <div className="shrink-0 flex items-start pt-1">
            <AlphabetIndex
              availableLetters={availableLetters}
              activeLetter={activeLetter}
              onLetterClick={scrollToLetter}
            />
          </div>
        )}

        {/* Scrollable card grid */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading all contacts...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              {allContacts.length === 0 ? 'No contacts found' : 'No contacts match your search'}
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(([letter, contacts]) => (
                <div
                  key={letter}
                  ref={(el) => { if (el) sectionRefs.current.set(letter, el); }}
                >
                  <div className="sticky top-0 bg-background/95 backdrop-blur z-10 py-1 mb-2 border-b">
                    <span className="text-sm font-semibold text-muted-foreground">{letter}</span>
                    <span className="text-xs text-muted-foreground/60 ml-2">({contacts.length})</span>
                  </div>
                  <div className="grid gap-2" style={gridStyle}>
                    {contacts.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        selected={selectedIds.has(contact.id)}
                        onSelect={handleSelect}
                        onClick={handleCardClick}
                        onDelete={handleQuickDelete}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ContactDetailDialog
        contact={editContact}
        mailboxId={contactsMailboxId}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />

      <DuplicatesPanel
        open={duplicatesOpen}
        onOpenChange={setDuplicatesOpen}
        contacts={allContacts}
        mailboxId={contactsMailboxId}
        onDeleted={handleBulkDeleted}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        mailboxId={contactsMailboxId}
        folderId={contactsFolderId}
        onImported={loadContacts}
      />
    </div>
  );
}
