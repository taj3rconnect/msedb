import { useState, useRef } from 'react';
import { Loader2, Upload, FileSpreadsheet, FileText } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ImportContact } from '@/api/mailboxes';
import { importContacts } from '@/api/mailboxes';

/** Parse CSV text into ImportContact[] */
function parseCSV(text: string): ImportContact[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
  const contacts: ImportContact[] = [];

  // Map common header names
  const findCol = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const nameCol = findCol(['display name', 'displayname', 'name', 'full name']);
  const firstNameCol = findCol(['first name', 'firstname', 'given name']);
  const lastNameCol = findCol(['last name', 'lastname', 'surname', 'family name']);
  const emailCol = findCol(['email', 'e-mail', 'mail']);
  const email2Col = findCol(['email 2', 'e-mail 2', 'other email']);
  const companyCol = findCol(['company', 'organization', 'org']);
  const titleCol = findCol(['job title', 'jobtitle', 'title']);
  const deptCol = findCol(['department', 'dept']);
  const phoneCol = findCol(['mobile', 'cell', 'mobile phone']);
  const busPhoneCol = findCol(['business phone', 'work phone', 'phone']);

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV field parsing (handles quoted fields)
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());

    const get = (idx: number) => (idx >= 0 && idx < fields.length ? fields[idx] : '');

    let displayName = get(nameCol);
    if (!displayName && (firstNameCol >= 0 || lastNameCol >= 0)) {
      displayName = [get(firstNameCol), get(lastNameCol)].filter(Boolean).join(' ');
    }
    if (!displayName) continue;

    const emailAddresses: Array<{ address: string; name: string }> = [];
    const email1 = get(emailCol);
    if (email1) emailAddresses.push({ address: email1, name: '' });
    const email2 = get(email2Col);
    if (email2) emailAddresses.push({ address: email2, name: '' });

    const businessPhones: string[] = [];
    const bp = get(busPhoneCol);
    if (bp) businessPhones.push(bp);

    contacts.push({
      displayName,
      emailAddresses: emailAddresses.length > 0 ? emailAddresses : undefined,
      companyName: get(companyCol) || undefined,
      jobTitle: get(titleCol) || undefined,
      department: get(deptCol) || undefined,
      mobilePhone: get(phoneCol) || undefined,
      businessPhones: businessPhones.length > 0 ? businessPhones : undefined,
    });
  }

  return contacts;
}

/** Parse vCard (.vcf) text into ImportContact[] */
function parseVCard(text: string): ImportContact[] {
  const contacts: ImportContact[] = [];
  const cards = text.split(/(?=BEGIN:VCARD)/i).filter((c) => c.trim());

  for (const card of cards) {
    const lines = card.split(/\r?\n/);
    let displayName = '';
    const emailAddresses: Array<{ address: string; name: string }> = [];
    let companyName = '';
    let jobTitle = '';
    let mobilePhone = '';
    const businessPhones: string[] = [];

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper.startsWith('FN:') || upper.startsWith('FN;')) {
        displayName = line.substring(line.indexOf(':') + 1).trim();
      } else if (upper.startsWith('EMAIL')) {
        const value = line.substring(line.indexOf(':') + 1).trim();
        if (value) emailAddresses.push({ address: value, name: '' });
      } else if (upper.startsWith('ORG:') || upper.startsWith('ORG;')) {
        companyName = line.substring(line.indexOf(':') + 1).split(';')[0].trim();
      } else if (upper.startsWith('TITLE:') || upper.startsWith('TITLE;')) {
        jobTitle = line.substring(line.indexOf(':') + 1).trim();
      } else if (upper.startsWith('TEL')) {
        const value = line.substring(line.indexOf(':') + 1).trim();
        if (upper.includes('CELL') || upper.includes('MOBILE')) {
          mobilePhone = value;
        } else if (value) {
          businessPhones.push(value);
        }
      }
    }

    if (!displayName) continue;
    contacts.push({
      displayName,
      emailAddresses: emailAddresses.length > 0 ? emailAddresses : undefined,
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      mobilePhone: mobilePhone || undefined,
      businessPhones: businessPhones.length > 0 ? businessPhones : undefined,
    });
  }

  return contacts;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxId: string;
  folderId: string;
  onImported: () => void;
}

export function ImportDialog({ open, onOpenChange, mailboxId, folderId, onImported }: ImportDialogProps) {
  const [parsed, setParsed] = useState<ImportContact[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const text = await file.text();
    const isVCard = file.name.toLowerCase().endsWith('.vcf');
    const contacts = isVCard ? parseVCard(text) : parseCSV(text);
    setParsed(contacts);
  };

  const handleImport = async () => {
    if (parsed.length === 0) return;
    setImporting(true);
    try {
      const res = await importContacts(mailboxId, folderId, parsed);
      setResult({ created: res.created, failed: res.failed });
      if (res.created > 0) onImported();
    } catch {
      // Error handled by apiFetch
    } finally {
      setImporting(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setParsed([]);
      setFileName('');
      setResult(null);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>Upload a CSV or vCard (.vcf) file to import contacts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.vcf"
            onChange={handleFile}
            className="hidden"
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {fileName || 'Choose File'}
          </Button>

          {parsed.length > 0 && !result && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Preview ({parsed.length} contacts)</div>
              <div className="max-h-48 overflow-y-auto rounded border divide-y">
                {parsed.slice(0, 50).map((c, i) => (
                  <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                    {fileName.endsWith('.vcf')
                      ? <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-sm truncate">{c.displayName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.emailAddresses?.map((e) => e.address).join(', ') || c.companyName || ''}
                      </div>
                    </div>
                  </div>
                ))}
                {parsed.length > 50 && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">
                    ... and {parsed.length - 50} more
                  </div>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-lg border p-3 text-sm">
              <div className="text-green-600">{result.created} contacts imported successfully</div>
              {result.failed > 0 && (
                <div className="text-destructive">{result.failed} failed to import</div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <Button onClick={handleImport} disabled={parsed.length === 0 || importing}>
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {parsed.length > 0 ? `(${parsed.length})` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
