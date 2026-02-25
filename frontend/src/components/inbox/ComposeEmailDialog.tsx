import { useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { SquarePen, ExternalLink, CalendarClock } from 'lucide-react';
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
import { scheduleEmail } from '@/api/scheduledEmails';
import { useQueryClient } from '@tanstack/react-query';

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
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const queryClient = useQueryClient();

  const resetForm = useCallback(() => {
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setBody('');
    setShowCcBcc(false);
    setSending(false);
    setShowSchedule(false);
    setScheduleDateTime('');
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    },
    [onOpenChange, resetForm],
  );

  const validateForm = (): string[] | null => {
    const toEmails = parseEmails(to);
    if (toEmails.length === 0) {
      toast.error('At least one recipient is required');
      return null;
    }
    if (!subject.trim()) {
      toast.error('Subject is required');
      return null;
    }
    if (!body.trim()) {
      toast.error('Message body is required');
      return null;
    }
    return toEmails;
  };

  const handleSend = async () => {
    const toEmails = validateForm();
    if (!toEmails) return;

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

  const handleSchedule = async () => {
    const toEmails = validateForm();
    if (!toEmails) return;

    if (!scheduleDateTime) {
      toast.error('Please select a date and time');
      return;
    }

    const scheduledDate = new Date(scheduleDateTime);
    if (scheduledDate.getTime() <= Date.now()) {
      toast.error('Scheduled time must be in the future');
      return;
    }

    setSending(true);
    try {
      const ccEmails = parseEmails(cc);
      const bccEmails = parseEmails(bcc);

      await scheduleEmail(fromMailboxId, {
        to: toEmails,
        ...(ccEmails.length > 0 && { cc: ccEmails }),
        ...(bccEmails.length > 0 && { bcc: bccEmails }),
        subject: subject.trim(),
        body: body.trim(),
        scheduledAt: scheduledDate.toISOString(),
      });

      queryClient.invalidateQueries({ queryKey: ['scheduled-emails'] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-count'] });

      const formatted = scheduledDate.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      toast.success(`Email scheduled for ${formatted}`);
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule email');
      setSending(false);
    }
  };

  // Default fromMailboxId when dialog opens if it's not set
  const effectiveFrom = fromMailboxId || connected[0]?.id || '';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
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
          <div className="grid gap-1.5 flex-1">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              placeholder="Write your message..."
              rows={22}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="resize-y min-h-[400px]"
            />
            <DetectedLinks text={body} />
          </div>
        </div>

        {/* Schedule date-time picker */}
        {showSchedule && (
          <div className="flex items-center gap-2 px-1">
            <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="datetime-local"
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          {showSchedule ? (
            <>
              <Button
                variant="outline"
                onClick={() => { setShowSchedule(false); setScheduleDateTime(''); }}
                disabled={sending}
              >
                Back
              </Button>
              <Button onClick={handleSchedule} disabled={sending}>
                {sending ? 'Scheduling...' : 'Confirm Schedule'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setShowSchedule(true)} disabled={sending}>
                <CalendarClock className="h-4 w-4 mr-1" />
                Schedule
              </Button>
              <Button onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Send Now'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

function DetectedLinks({ text }: { text: string }) {
  const urls = useMemo(() => extractUrls(text), [text]);
  if (urls.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Links:</span>
      {urls.map((url) => {
        let label = url;
        try {
          const u = new URL(url);
          label = u.hostname + (u.pathname !== '/' ? u.pathname : '');
          if (label.length > 50) label = label.substring(0, 47) + '...';
        } catch { /* use raw url */ }
        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline bg-blue-50 dark:bg-blue-950/30 rounded px-1.5 py-0.5"
            title={url}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {label}
          </a>
        );
      })}
    </div>
  );
}
