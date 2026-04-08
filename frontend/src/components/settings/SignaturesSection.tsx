import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Star, StarOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateMailboxSignatures, type Signature, type MailboxInfo } from '@/api/settings';

interface MailboxSignaturesProps {
  mailbox: MailboxInfo;
}

function MailboxSignatures({ mailbox }: MailboxSignaturesProps) {
  const queryClient = useQueryClient();
  const [signatures, setSignatures] = useState<Signature[]>(mailbox.signatures ?? []);
  const [editingId, setEditingId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (sigs: Signature[]) => updateMailboxSignatures(mailbox.id, sigs),
    onSuccess: (data) => {
      setSignatures(data.signatures);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Signatures saved');
    },
    onError: () => toast.error('Failed to save signatures'),
  });

  function addSignature() {
    const newSig: Signature = {
      id: crypto.randomUUID(),
      name: 'New Signature',
      content: '',
      isDefault: signatures.length === 0,
    };
    const updated = [...signatures, newSig];
    setSignatures(updated);
    setEditingId(newSig.id);
  }

  function updateField(id: string, field: keyof Signature, value: string | boolean) {
    setSignatures((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  function setDefault(id: string) {
    setSignatures((prev) => prev.map((s) => ({ ...s, isDefault: s.id === id })));
  }

  function remove(id: string) {
    const updated = signatures.filter((s) => s.id !== id);
    // If we removed the default, set first remaining as default
    if (updated.length > 0 && !updated.some((s) => s.isDefault)) {
      updated[0].isDefault = true;
    }
    setSignatures(updated);
    if (editingId === id) setEditingId(null);
  }

  function save() {
    mutation.mutate(signatures);
  }

  const hasChanges = JSON.stringify(signatures) !== JSON.stringify(mailbox.signatures ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{mailbox.email}</CardTitle>
        <CardDescription>
          Signatures are auto-appended when composing new emails from this account.
          Mark one as default to use it automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {signatures.length === 0 && (
          <p className="text-sm text-muted-foreground">No signatures yet. Add one below.</p>
        )}

        {signatures.map((sig) => (
          <div key={sig.id} className="border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={sig.name}
                onChange={(e) => updateField(sig.id, 'name', e.target.value)}
                className="h-8 text-sm font-medium flex-1"
                placeholder="Signature name"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title={sig.isDefault ? 'Default signature' : 'Set as default'}
                onClick={() => setDefault(sig.id)}
              >
                {sig.isDefault ? (
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ) : (
                  <StarOff className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                onClick={() => remove(sig.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {editingId === sig.id ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Content</Label>
                <Textarea
                  value={sig.content}
                  onChange={(e) => updateField(sig.id, 'content', e.target.value)}
                  rows={4}
                  placeholder="-- &#10;Your Name&#10;Your Title | Company"
                  className="text-sm font-mono"
                />
                <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <div
                className="text-sm text-muted-foreground whitespace-pre-wrap cursor-pointer hover:text-foreground transition-colors border rounded px-2 py-1.5 min-h-[2rem]"
                onClick={() => setEditingId(sig.id)}
              >
                {sig.content || <span className="italic text-xs">Click to edit…</span>}
              </div>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" onClick={addSignature}>
            <Plus className="h-4 w-4 mr-1" />
            Add Signature
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!hasChanges || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface SignaturesSectionProps {
  settings: { mailboxes: MailboxInfo[] };
}

export function SignaturesSection({ settings }: SignaturesSectionProps) {
  const { mailboxes } = settings;

  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No mailboxes connected. Connect a mailbox to manage signatures.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => (
        <MailboxSignatures key={mailbox.id} mailbox={mailbox} />
      ))}
    </div>
  );
}
