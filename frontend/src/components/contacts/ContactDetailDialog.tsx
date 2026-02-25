import { useState, useEffect } from 'react';
import { Loader2, Trash2, Plus, X, Mail, Phone } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Contact } from '@/api/mailboxes';
import { updateContact, deleteContact } from '@/api/mailboxes';

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

function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface ContactDetailDialogProps {
  contact: Contact | null;
  mailboxId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (contact: Contact) => void;
  onDeleted: (contactId: string) => void;
}

export function ContactDetailDialog({
  contact, mailboxId, open, onOpenChange, onUpdated, onDeleted,
}: ContactDetailDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [emails, setEmails] = useState<Array<{ address: string; name: string }>>([]);
  const [companyName, setCompanyName] = useState('');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [businessPhones, setBusinessPhones] = useState<string[]>([]);
  const [mobilePhone, setMobilePhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Populate form when dialog opens or contact changes
  useEffect(() => {
    if (open && contact) {
      setDisplayName(contact.displayName);
      setEmails(contact.emailAddresses.map((e) => ({ address: e.address || '', name: e.name || '' })));
      setCompanyName(contact.companyName);
      setDepartment(contact.department);
      setJobTitle(contact.jobTitle);
      setBusinessPhones([...contact.businessPhones]);
      setMobilePhone(contact.mobilePhone);
      setDirty(false);
    }
  }, [open, contact]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      await updateContact(mailboxId, contact.id, {
        displayName,
        emailAddresses: emails.filter((e) => e.address),
        companyName,
        department,
        jobTitle,
        businessPhones: businessPhones.filter(Boolean),
        mobilePhone,
      });
      onUpdated({
        ...contact,
        displayName,
        emailAddresses: emails.filter((e) => e.address),
        companyName,
        department,
        jobTitle,
        businessPhones: businessPhones.filter(Boolean),
        mobilePhone,
      });
      onOpenChange(false);
    } catch {
      // Error handled by apiFetch toast
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!contact) return;
    setDeleting(true);
    try {
      await deleteContact(mailboxId, contact.id);
      onDeleted(contact.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
    } catch {
      // Error handled by apiFetch toast
    } finally {
      setDeleting(false);
    }
  };

  const addEmail = () => { setEmails([...emails, { address: '', name: '' }]); markDirty(); };
  const removeEmail = (idx: number) => { setEmails(emails.filter((_, i) => i !== idx)); markDirty(); };
  const addPhone = () => { setBusinessPhones([...businessPhones, '']); markDirty(); };
  const removePhone = (idx: number) => { setBusinessPhones(businessPhones.filter((_, i) => i !== idx)); markDirty(); };

  if (!contact) return null;

  const avatarColor = nameToColor(displayName || contact.displayName);
  const initials = getInitials(displayName || contact.displayName);
  const allPhones = [
    ...(mobilePhone ? [{ label: 'Mobile', value: mobilePhone }] : []),
    ...businessPhones.filter(Boolean).map((p) => ({ label: 'Work', value: p })),
  ];
  const primaryEmail = emails.find((e) => e.address)?.address;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto p-0">
          <div className="flex min-h-[400px]">
            {/* Left: Edit form */}
            <div className="flex-1 p-6 space-y-4 border-r overflow-y-auto">
              <DialogHeader className="pb-0">
                <DialogTitle className="text-lg">Edit Contact</DialogTitle>
              </DialogHeader>

              {/* Name + Avatar row */}
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">Full Name</span>
                    <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); markDirty(); }} />
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">Company</span>
                    <Input value={companyName} onChange={(e) => { setCompanyName(e.target.value); markDirty(); }} />
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">Job title</span>
                    <Input value={jobTitle} onChange={(e) => { setJobTitle(e.target.value); markDirty(); }} />
                  </div>
                  <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">Department</span>
                    <Input value={department} onChange={(e) => { setDepartment(e.target.value); markDirty(); }} />
                  </div>
                </div>
                <div className={`${avatarColor} h-16 w-16 rounded-md flex items-center justify-center text-white text-xl font-semibold shrink-0`}>
                  {initials}
                </div>
              </div>

              {/* Internet / Email section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</span>
                  <Button variant="ghost" size="xs" onClick={addEmail}><Plus className="h-3 w-3" /> Add</Button>
                </div>
                {emails.map((email, idx) => (
                  <div key={idx} className="grid grid-cols-[100px_1fr_auto] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">{idx === 0 ? 'Email' : `Email ${idx + 1}`}</span>
                    <Input
                      placeholder="email@example.com"
                      value={email.address}
                      onChange={(e) => {
                        const copy = [...emails];
                        copy[idx] = { ...copy[idx], address: e.target.value };
                        setEmails(copy);
                        markDirty();
                      }}
                    />
                    <Button variant="ghost" size="icon-xs" onClick={() => removeEmail(idx)}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>

              {/* Phone numbers section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Phone numbers</span>
                  <Button variant="ghost" size="xs" onClick={addPhone}><Plus className="h-3 w-3" /> Add</Button>
                </div>
                {businessPhones.map((phone, idx) => (
                  <div key={`b-${idx}`} className="grid grid-cols-[100px_1fr_auto] items-center gap-2">
                    <span className="text-sm text-muted-foreground text-right">Business</span>
                    <Input
                      value={phone}
                      onChange={(e) => {
                        const copy = [...businessPhones];
                        copy[idx] = e.target.value;
                        setBusinessPhones(copy);
                        markDirty();
                      }}
                    />
                    <Button variant="ghost" size="icon-xs" onClick={() => removePhone(idx)}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="text-sm text-muted-foreground text-right">Mobile</span>
                  <Input value={mobilePhone} onChange={(e) => { setMobilePhone(e.target.value); markDirty(); }} />
                </div>
              </div>

              {/* Footer actions */}
              <DialogFooter className="flex-row justify-between sm:justify-between pt-2 border-t">
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save
                  </Button>
                </div>
              </DialogFooter>
            </div>

            {/* Right: Contact card preview */}
            <div className="w-64 shrink-0 p-5 bg-muted/30">
              <div className="rounded-lg border bg-card p-4 space-y-3">
                {/* Avatar + Name */}
                <div className="flex items-center gap-3">
                  <div className={`${avatarColor} h-12 w-12 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0`}>
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{displayName || '(No name)'}</div>
                    {(companyName || jobTitle) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {[jobTitle, companyName].filter(Boolean).join(', ')}
                      </div>
                    )}
                    {department && (
                      <div className="text-xs text-muted-foreground truncate">{department}</div>
                    )}
                  </div>
                </div>

                {/* Phone list */}
                {allPhones.length > 0 && (
                  <div className="space-y-1">
                    {allPhones.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-primary truncate">{p.value}</span>
                        <span className="text-muted-foreground">{p.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Email */}
                {primaryEmail && (
                  <div className="flex items-center gap-2 text-xs">
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-primary truncate">{primaryEmail}</span>
                  </div>
                )}

                {/* Additional emails */}
                {emails.filter((e) => e.address).slice(1).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-primary truncate">{e.address}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{contact.displayName}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-white hover:bg-destructive/90">
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
