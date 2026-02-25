import { useState, useEffect, useRef } from 'react';
import { Contact as ContactIcon, Search, X, Loader2, Building2, Phone, Mail, Briefcase } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSettings } from '@/hooks/useSettings';
import { searchContacts, type Contact } from '@/api/mailboxes';

export function ContactsPage() {
  const { data: settingsData, isLoading: settingsLoading } = useSettings();
  const contactsMailboxId = settingsData?.user.preferences.contactsMailboxId;
  const contactsFolderId = settingsData?.user.preferences.contactsFolderId;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load all contacts on mount when configured
  useEffect(() => {
    if (!contactsMailboxId || !contactsFolderId) return;
    setLoading(true);
    searchContacts(contactsMailboxId, contactsFolderId)
      .then(({ contacts }) => {
        setResults(contacts);
        setHasSearched(true);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [contactsMailboxId, contactsFolderId]);

  // Debounced search
  useEffect(() => {
    if (!contactsMailboxId || !contactsFolderId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { contacts } = await searchContacts(
          contactsMailboxId,
          contactsFolderId,
          query || undefined,
        );
        setResults(contacts);
        setHasSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, query ? 300 : 0);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, contactsMailboxId, contactsFolderId]);

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
      {/* Header */}
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
        <p className="text-muted-foreground text-sm">Search your Microsoft 365 contacts</p>
      </div>

      {/* Search bar */}
      <div className="shrink-0 mb-3 relative">
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

      {/* Results count */}
      {hasSearched && !loading && (
        <div className="shrink-0 mb-2 text-xs text-muted-foreground">
          {results.length} contact{results.length !== 1 ? 's' : ''} found
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : results.length === 0 && hasSearched ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No contacts found
          </div>
        ) : (
          <div className="grid gap-2">
            {results.map((contact) => (
              <div
                key={contact.id}
                className="rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="font-medium text-sm">{contact.displayName}</div>
                {contact.emailAddresses.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <Mail className="h-3 w-3 shrink-0" />
                    {contact.emailAddresses.map((e) => e.address).filter(Boolean).join(', ')}
                  </div>
                )}
                {(contact.jobTitle || contact.companyName || contact.department) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    {contact.companyName ? (
                      <Building2 className="h-3 w-3 shrink-0" />
                    ) : (
                      <Briefcase className="h-3 w-3 shrink-0" />
                    )}
                    {[contact.jobTitle, contact.companyName, contact.department]
                      .filter(Boolean)
                      .join(' \u00B7 ')}
                  </div>
                )}
                {(contact.mobilePhone || contact.businessPhones.length > 0) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <Phone className="h-3 w-3 shrink-0" />
                    {[contact.mobilePhone, ...contact.businessPhones].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
