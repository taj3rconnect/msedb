import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { searchContacts, type Contact } from '@/api/mailboxes';

interface InboxContactsPanelProps {
  contactsMailboxId?: string;
  contactsFolderId?: string;
}

export function InboxContactsPanel({ contactsMailboxId, contactsFolderId }: InboxContactsPanelProps) {
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced contact search
  useEffect(() => {
    if (!contactsMailboxId || !contactsFolderId) return;

    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(async () => {
      setContactsLoading(true);
      try {
        const { contacts } = await searchContacts(
          contactsMailboxId,
          contactsFolderId,
          contactQuery || undefined,
        );
        setContactResults(contacts);
      } catch {
        setContactResults([]);
      } finally {
        setContactsLoading(false);
      }
    }, contactQuery ? 300 : 0);

    return () => {
      if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    };
  }, [contactQuery, contactsMailboxId, contactsFolderId]);

  return (
    <div className="flex-1 overflow-auto">
      {!contactsMailboxId || !contactsFolderId ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Configure a contact folder in Settings &rarr; Contacts first.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              className="pl-9"
            />
            {contactQuery && (
              <button
                onClick={() => setContactQuery('')}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {contactsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : contactResults.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              {contactQuery ? 'No contacts found' : 'Type to search contacts'}
            </div>
          ) : (
            <div className="divide-y">
              {contactResults.map((contact) => (
                <div key={contact.id} className="py-2.5 px-1">
                  <div className="font-medium text-sm">{contact.displayName}</div>
                  {contact.emailAddresses.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {contact.emailAddresses.map((e) => e.address).filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[contact.jobTitle, contact.companyName, contact.department]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {(contact.mobilePhone || contact.businessPhones.length > 0) && (
                    <div className="text-xs text-muted-foreground">
                      {[contact.mobilePhone, ...contact.businessPhones].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
