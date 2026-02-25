import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import MiniSearch from 'minisearch';
import {
  Contact as ContactIcon, Search, X, Loader2, Download, Upload,
  Users, ChevronDown, LayoutGrid, RefreshCw, Database,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSettings } from '@/hooks/useSettings';
import { fetchAllContacts, refreshAllContacts, deleteContact, type Contact } from '@/api/mailboxes';
import { ContactCard } from '@/components/contacts/ContactCard';
import { ContactDetailDialog } from '@/components/contacts/ContactDetailDialog';
import { AlphabetIndex } from '@/components/contacts/AlphabetIndex';
import { DuplicatesPanel } from '@/components/contacts/DuplicatesPanel';
import { ImportDialog } from '@/components/contacts/ImportDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/** Strip HTML tags to get plain text for indexing. */
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Flatten a Contact into a searchable document for MiniSearch. */
function contactToDoc(c: Contact) {
  return {
    id: c.id,
    displayName: c.displayName,
    emails: c.emailAddresses.map((e) => e.address).filter(Boolean).join(' '),
    companyName: c.companyName,
    jobTitle: c.jobTitle,
    department: c.department,
    mobilePhone: c.mobilePhone,
    businessPhones: c.businessPhones.filter(Boolean).join(' '),
    personalNotes: stripHtml(c.personalNotes || ''),
  };
}

/** Create and populate a MiniSearch index from contacts. */
function buildIndex(contacts: Contact[]) {
  const ms = new MiniSearch({
    fields: ['displayName', 'emails', 'companyName', 'jobTitle', 'department', 'mobilePhone', 'businessPhones', 'personalNotes'],
    storeFields: ['id'],
    searchOptions: {
      boost: { displayName: 3, emails: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
    },
  });
  ms.addAll(contacts.map(contactToDoc));
  return ms;
}

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

const BATCH_SIZE = 80;

export function ContactsPage() {
  const { data: settingsData, isLoading: settingsLoading } = useSettings();
  const contactsMailboxId = settingsData?.user.preferences.contactsMailboxId;
  const contactsFolderId = settingsData?.user.preferences.contactsFolderId;

  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexedAt, setIndexedAt] = useState<Date | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editIndex, setEditIndex] = useState<number>(-1);
  const [editOpen, setEditOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeLetter, setActiveLetter] = useState('');
  const [columnsPerRow, setColumnsPerRow] = useState(() => {
    const saved = localStorage.getItem('contacts-columns');
    return saved ? parseInt(saved, 10) : 4;
  });

  const [visibleLimit, setVisibleLimit] = useState(BATCH_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const searchIndexRef = useRef<MiniSearch | null>(null);
  const loadingMoreRef = useRef(false);

  // / key focuses search (same as InboxPage)
  useKeyboardShortcuts(useMemo(() => [
    { key: '/', action: () => { inputRef.current?.focus(); } },
    { key: 'Escape', action: () => {
      if (query) setQuery('');
      else inputRef.current?.blur();
    }},
  ], [query]));

  // Build MiniSearch index whenever contacts change — use setTimeout to avoid blocking UI
  useEffect(() => {
    if (allContacts.length === 0) {
      searchIndexRef.current = null;
      return;
    }
    setIndexing(true);
    const timer = setTimeout(() => {
      searchIndexRef.current = buildIndex(allContacts);
      setIndexedAt(new Date());
      setIndexing(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [allContacts]);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load contacts (cache-first — instant when cached)
  const loadContacts = useCallback(async (isRetry = false) => {
    if (!contactsMailboxId || !contactsFolderId) return;
    if (!isRetry) setLoading(true);
    try {
      const result = await fetchAllContacts(contactsMailboxId, contactsFolderId);
      setAllContacts(result.contacts);
      setSyncedAt(result.syncedAt);
      setPartial(!!result.partial);

      // If partial (background still fetching), auto-retry to get the full set
      if (result.partial) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => loadContacts(true), 3000);
      }
    } catch {
      setAllContacts([]);
    } finally {
      setLoading(false);
    }
  }, [contactsMailboxId, contactsFolderId]);

  useEffect(() => {
    loadContacts();
    return () => clearTimeout(retryTimerRef.current);
  }, [loadContacts]);

  // Force refresh: bypass cache, re-fetch from Graph API + rebuild cache + index
  const handleReindex = async () => {
    if (!contactsMailboxId || !contactsFolderId) return;
    setRefreshing(true);
    try {
      const result = await refreshAllContacts(contactsMailboxId, contactsFolderId);
      setAllContacts(result.contacts);
      setSyncedAt(result.syncedAt);
      setPartial(!!result.partial);

      // If partial (background still fetching), auto-retry to get the full set
      if (result.partial) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => loadContacts(true), 3000);
      }
    } catch {
      // Error handled by apiFetch toast
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset visible limit when query or contacts change
  useEffect(() => { setVisibleLimit(BATCH_SIZE); }, [query, allContacts]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allContacts;
    const index = searchIndexRef.current;
    if (!index) return allContacts;

    const results = index.search(query.trim());
    const matchedIds = new Set(results.map((r) => r.id));
    return allContacts.filter((c) => matchedIds.has(c.id));
  }, [allContacts, query]);

  // Slice to visible limit for progressive rendering
  const visibleContacts = useMemo(
    () => filtered.slice(0, visibleLimit),
    [filtered, visibleLimit],
  );
  const hasMore = filtered.length > visibleLimit;

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of visibleContacts) {
      const letter = getLetterKey(c.displayName);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [visibleContacts]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const c of filtered) letters.add(getLetterKey(c.displayName));
    return letters;
  }, [filtered]);

  // Load more on scroll — throttled via loadingMoreRef to prevent runaway loops
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    // Use setTimeout to yield the main thread between batches
    setTimeout(() => {
      setVisibleLimit((prev) => {
        const next = prev + BATCH_SIZE;
        return next;
      });
      loadingMoreRef.current = false;
    }, 100);
  }, []);

  // Scroll-based load more (simple scroll listener instead of IntersectionObserver)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        // Track active letter
        const containerTop = container.getBoundingClientRect().top;
        let current = '';
        for (const [letter, el] of sectionRefs.current) {
          const rect = el.getBoundingClientRect();
          if (rect.top - containerTop <= 40) current = letter;
        }
        if (current) setActiveLetter(current);

        // Load more when near bottom
        const { scrollTop, scrollHeight, clientHeight } = container;
        if (scrollHeight - scrollTop - clientHeight < 400) {
          loadMore();
        }

        ticking = false;
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  // Scroll to letter section — expand visible limit if needed
  const scrollToLetter = (letter: string) => {
    // Find how many contacts we need visible to reach this letter
    let count = 0;
    for (const c of filtered) {
      count++;
      if (getLetterKey(c.displayName) === letter) break;
    }
    if (count > visibleLimit) {
      setVisibleLimit(count + BATCH_SIZE);
      requestAnimationFrame(() => {
        const el = sectionRefs.current.get(letter);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      const el = sectionRefs.current.get(letter);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveLetter(letter);
  };

  // Selection
  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Derive editContact from editIndex into filtered array
  const editContact = editIndex >= 0 && editIndex < filtered.length ? filtered[editIndex] : null;

  // Card click → edit
  const handleCardClick = useCallback((contact: Contact) => {
    const idx = filtered.findIndex((c) => c.id === contact.id);
    setEditIndex(idx >= 0 ? idx : 0);
    setEditOpen(true);
  }, [filtered]);

  // Next/previous navigation in sheet
  const handleNext = useCallback(() => {
    setEditIndex((i) => {
      const next = Math.min(i + 1, filtered.length - 1);
      // Expand visible limit if navigating past current range
      if (next >= visibleLimit) setVisibleLimit(next + BATCH_SIZE);
      return next;
    });
  }, [filtered.length, visibleLimit]);

  const handlePrevious = useCallback(() => {
    setEditIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Quick delete from card
  const handleQuickDelete = useCallback(async (contact: Contact) => {
    if (!contactsMailboxId) return;
    try {
      await deleteContact(contactsMailboxId, contact.id);
      setAllContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch {
      // Error handled by apiFetch
    }
  }, [contactsMailboxId]);

  // After edit save
  const handleUpdated = (updated: Contact) => {
    setAllContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  // After single delete from dialog — show next contact or close sheet
  const handleDeleted = (id: string) => {
    setAllContacts((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      // After state updates, the filtered array shrinks by 1.
      // If editIndex is now past the end, clamp it back; if no contacts left, close.
      const newFilteredLen = remaining.length; // approximate (search may narrow further)
      if (newFilteredLen === 0) {
        setEditOpen(false);
        setEditIndex(-1);
      } else if (editIndex >= newFilteredLen) {
        setEditIndex(newFilteredLen - 1);
      }
      // else editIndex stays — the next contact slides into place
      return remaining;
    });
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
      <TooltipProvider delayDuration={300}>
      <div className="shrink-0 mb-3 relative z-20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            {/* Index status badge */}
            {loading ? (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </Badge>
            ) : refreshing ? (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Loader2 className="h-3 w-3 animate-spin" />
                Refreshing...
              </Badge>
            ) : indexing ? (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Loader2 className="h-3 w-3 animate-spin" />
                Indexing...
              </Badge>
            ) : indexedAt ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="gap-1 text-xs font-normal cursor-default">
                    <Database className="h-3 w-3" />
                    {allContacts.length} indexed
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Searches: name, email, company, title, department, phone
                  <br />
                  Prefix matching + fuzzy search
                </TooltipContent>
              </Tooltip>
            ) : null}
            {partial && !loading && (
              <Badge variant="outline" className="gap-1 text-xs font-normal">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading remaining...
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Refresh from server — right side with timestamp */}
            {!loading && allContacts.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="text-right">
                  {syncedAt && (
                    <div className="text-[10px] text-muted-foreground leading-tight">
                      Last refreshed: {new Date(syncedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={handleReindex}
                      disabled={refreshing}
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Fetch fresh from server</TooltipContent>
                </Tooltip>
              </div>
            )}
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
            placeholder="Search all fields — name, email, company, title, department, phone... (press /)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="absolute right-2.5 top-2 pointer-events-none text-[10px] text-muted-foreground/60 border rounded px-1 py-0.5 bg-muted/50">/</kbd>
          )}
        </div>

        {/* Filter count */}
        {!loading && query.trim() && (
          <div className="text-xs text-muted-foreground mt-1.5">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''} for &quot;{query}&quot;
          </div>
        )}
      </div>
      </TooltipProvider>

      {/* Main content: alphabet index + card grid */}
      <div className="flex-1 flex gap-1 overflow-hidden min-h-0">
        {/* Alphabet index */}
        {!loading && filtered.length > 0 && (
          <div className="shrink-0 flex items-start pt-1 relative z-10">
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
              <span className="ml-2 text-sm text-muted-foreground">Loading contacts...</span>
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
              {/* Load more indicator */}
              {hasMore && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-xs text-muted-foreground">
                    Showing {visibleContacts.length} of {filtered.length}...
                  </span>
                </div>
              )}
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
        onNext={handleNext}
        onPrevious={handlePrevious}
        hasNext={editIndex < filtered.length - 1}
        hasPrevious={editIndex > 0}
        currentIndex={editIndex}
        totalCount={filtered.length}
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
