import { useState } from 'react';
import { Loader2, Trash2, Plus, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Contact } from '@/api/mailboxes';
import { updateContact, deleteContact } from '@/api/mailboxes';

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

  // Reset form when contact changes
  const resetForm = (c: Contact) => {
    setDisplayName(c.displayName);
    setEmails(c.emailAddresses.map((e) => ({ address: e.address || '', name: e.name || '' })));
    setCompanyName(c.companyName);
    setDepartment(c.department);
    setJobTitle(c.jobTitle);
    setBusinessPhones([...c.businessPhones]);
    setMobilePhone(c.mobilePhone);
    setDirty(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && contact) {
      resetForm(contact);
    }
    onOpenChange(isOpen);
  };

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

  const addEmail = () => {
    setEmails([...emails, { address: '', name: '' }]);
    markDirty();
  };

  const removeEmail = (idx: number) => {
    setEmails(emails.filter((_, i) => i !== idx));
    markDirty();
  };

  const addPhone = () => {
    setBusinessPhones([...businessPhones, '']);
    markDirty();
  };

  const removePhone = (idx: number) => {
    setBusinessPhones(businessPhones.filter((_, i) => i !== idx));
    markDirty();
  };

  if (!contact) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Display Name */}
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
              />
            </div>

            {/* Emails */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Email Addresses</Label>
                <Button variant="ghost" size="xs" onClick={addEmail}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
              {emails.map((email, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <Input
                    placeholder="email@example.com"
                    value={email.address}
                    onChange={(e) => {
                      const copy = [...emails];
                      copy[idx] = { ...copy[idx], address: e.target.value };
                      setEmails(copy);
                      markDirty();
                    }}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon-xs" onClick={() => removeEmail(idx)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Company */}
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input value={companyName} onChange={(e) => { setCompanyName(e.target.value); markDirty(); }} />
            </div>

            {/* Job Title */}
            <div className="space-y-1.5">
              <Label>Job Title</Label>
              <Input value={jobTitle} onChange={(e) => { setJobTitle(e.target.value); markDirty(); }} />
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input value={department} onChange={(e) => { setDepartment(e.target.value); markDirty(); }} />
            </div>

            {/* Mobile Phone */}
            <div className="space-y-1.5">
              <Label>Mobile Phone</Label>
              <Input value={mobilePhone} onChange={(e) => { setMobilePhone(e.target.value); markDirty(); }} />
            </div>

            {/* Business Phones */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Business Phones</Label>
                <Button variant="ghost" size="xs" onClick={addPhone}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
              {businessPhones.map((phone, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <Input
                    value={phone}
                    onChange={(e) => {
                      const copy = [...businessPhones];
                      copy[idx] = e.target.value;
                      setBusinessPhones(copy);
                      markDirty();
                    }}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon-xs" onClick={() => removePhone(idx)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
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
