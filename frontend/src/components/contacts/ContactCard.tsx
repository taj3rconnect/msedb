import { memo } from 'react';
import { Trash2, Mail, Phone, Building2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { Contact } from '@/api/mailboxes';

/** Generate a consistent color from a name string. */
function nameToColor(name: string): string {
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-pink-600', 'bg-indigo-600',
    'bg-teal-600', 'bg-orange-600', 'bg-fuchsia-600', 'bg-lime-600',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Extract initials from a display name (max 2 chars). */
function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface ContactCardProps {
  contact: Contact;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onClick: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
}

/** Derive a display label for a contact — name, email, or phone. */
function getLabel(contact: Contact): string {
  if (contact.displayName?.trim()) return contact.displayName.trim();
  const email = contact.emailAddresses?.find((e) => e.address)?.address;
  if (email) return email;
  if (contact.mobilePhone?.trim()) return contact.mobilePhone.trim();
  const phone = contact.businessPhones?.find(Boolean);
  if (phone) return phone;
  if (contact.companyName?.trim()) return contact.companyName.trim();
  return '(No name)';
}

export const ContactCard = memo(function ContactCard({ contact, selected, onSelect, onClick, onDelete }: ContactCardProps) {
  const label = getLabel(contact);
  const initials = getInitials(label);
  const avatarColor = nameToColor(label);
  const primaryEmail = contact.emailAddresses.find((e) => e.address)?.address;
  const infoLine = [contact.companyName, contact.jobTitle, contact.department]
    .filter(Boolean)
    .join(' \u00B7 ');
  const phones = [contact.mobilePhone, ...contact.businessPhones].filter(Boolean);

  return (
    <div
      className="group relative rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors cursor-pointer flex flex-col gap-2"
      onClick={() => onClick(contact)}
    >
      {/* Checkbox + delete */}
      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => {
            onSelect(contact.id, !!checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(contact);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Avatar + Name */}
      <div className="flex items-center gap-2.5 mt-1">
        <div className={`${avatarColor} h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{label}</div>
        </div>
      </div>

      {/* Email */}
      {primaryEmail && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{primaryEmail}</span>
        </div>
      )}

      {/* Company/Title */}
      {infoLine && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{infoLine}</span>
        </div>
      )}

      {/* Phone */}
      {phones.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <Phone className="h-3 w-3 shrink-0" />
          <span className="truncate">{phones[0]}</span>
        </div>
      )}
    </div>
  );
});
