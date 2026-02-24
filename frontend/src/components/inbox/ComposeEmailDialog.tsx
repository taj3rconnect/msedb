import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { SquarePen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { sendNewEmail } from '@/api/mailboxes';

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseEmails(input: string): string[] {
  return input
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

export function ComposeEmailDialog({ open, onOpenChange }: ComposeEmailDialogProps) {
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connected = mailboxes.filter((m) => m.isConnected);

  const [fromMailboxId, setFromMailboxId] = useState(connected[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);

  const resetForm = useCallback(() => {
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setBody('');
    setShowCcBcc(false);
    setSending(false);
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    },
    [onOpenChange, resetForm],
  );

  const handleSend = async () => {
    const toEmails = parseEmails(to);
    if (toEmails.length === 0) {
      toast.error('At least one recipient is required');
      return;
    }
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    if (!body.trim()) {
      toast.error('Message body is required');
      return;
    }

    setSending(true);
    try {
      const ccEmails = parseEmails(cc);
      const bccEmails = parseEmails(bcc);

      await sendNewEmail(fromMailboxId, {
        to: toEmails,
        ...(ccEmails.length > 0 && { cc: ccEmails }),
        ...(bccEmails.length > 0 && { bcc: bccEmails }),
        subject: subject.trim(),
        body: body.trim(),
      });

      toast.success('Email sent');
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send email');
      setSending(false);
    }
  };

  // Default fromMailboxId when dialog opens if it's not set
  const effectiveFrom = fromMailboxId || connected[0]?.id || '';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SquarePen className="h-4 w-4" />
            New Email
          </DialogTitle>
          <DialogDescription>
            Compose and send an email from a connected mailbox.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* Send From */}
          <div className="grid gap-1.5">
            <Label htmlFor="compose-from">Send From</Label>
            <Select value={effectiveFrom} onValueChange={setFromMailboxId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select mailbox" />
              </SelectTrigger>
              <SelectContent>
                {connected.map((mb) => (
                  <SelectItem key={mb.id} value={mb.id}>
                    {mb.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* To */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="compose-to">To</Label>
              {!showCcBcc && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowCcBcc(true)}
                >
                  CC / BCC
                </button>
              )}
            </div>
            <Input
              id="compose-to"
              placeholder="recipient@example.com, ..."
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          {/* CC / BCC — collapsible */}
          {showCcBcc && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="compose-cc">CC</Label>
                <Input
                  id="compose-cc"
                  placeholder="cc@example.com, ..."
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="compose-bcc">BCC</Label>
                <Input
                  id="compose-bcc"
                  placeholder="bcc@example.com, ..."
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Subject */}
          <div className="grid gap-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              placeholder="Email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="grid gap-1.5">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              placeholder="Write your message..."
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="resize-y"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
