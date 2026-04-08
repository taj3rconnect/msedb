import { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { SquarePen, ExternalLink, CalendarClock, Eye } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { EmailAutocomplete } from './EmailAutocomplete';
import { useSettings } from '@/hooks/useSettings';
import { AiWriteToolbar } from '@/components/shared/AiWriteToolbar';

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ComposeEmailDialog({ open, onOpenChange }: ComposeEmailDialogProps) {
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const connected = mailboxes.filter((m) => m.isConnected);
  const { data: settings } = useSettings();

  const [fromMailboxId, setFromMailboxId] = useState(connected[0]?.id ?? '');
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [trackEmail, setTrackEmail] = useState(true);
  const queryClient = useQueryClient();

  // Inject default signature when dialog opens or "from" account changes
  useEffect(() => {
    if (!open) return;
    const mailboxInfo = settings?.mailboxes?.find((m) => m.id === (fromMailboxId || connected[0]?.id));
    const defaultSig = mailboxInfo?.signatures?.find((s) => s.isDefault);
    if (defaultSig?.content) {
      setBody((prev) => {
        // Only inject if body is empty or already just a signature (starts with \n\n--)
        if (prev === '' || /^\n\n--\s*\n/.test(prev)) {
          return `\n\n-- \n${defaultSig.content}`;
        }
        return prev;
      });
    }
  }, [open, fromMailboxId, settings?.mailboxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = useCallback(() => {
    setTo([]);
    setCc([]);
    setBcc([]);
    setSubject('');
    setBody('');
    setShowCcBcc(false);
    setSending(false);
    setShowSchedule(false);
    setScheduleDateTime('');
    setTrackEmail(true);
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    },
    [onOpenChange, resetForm],
  );

  const validateForm = (): boolean => {
    if (to.length === 0) {
      toast.error('At least one recipient is required');
      return false;
    }
    if (!subject.trim()) {
      toast.error('Subject is required');
      return false;
    }
    if (!body.trim()) {
      toast.error('Message body is required');
      return false;
    }
    return true;
  };

  const handleSend = async () => {
    if (!validateForm()) return;

    setSending(true);
    try {
      await sendNewEmail(fromMailboxId, {
        to,
        ...(cc.length > 0 && { cc }),
        ...(bcc.length > 0 && { bcc }),
        subject: subject.trim(),
        body: body.trim(),
        track: trackEmail,
      });

      toast.success('Email sent');
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send email');
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!validateForm()) return;

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
      await scheduleEmail(fromMailboxId, {
        to,
        ...(cc.length > 0 && { cc }),
        ...(bcc.length > 0 && { bcc }),
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
            <EmailAutocomplete
              id="compose-to"
              value={to}
              onChange={setTo}
              placeholder="recipient@example.com"
            />
          </div>

          {/* CC / BCC — collapsible */}
          {showCcBcc && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="compose-cc">CC</Label>
                <EmailAutocomplete
                  id="compose-cc"
                  value={cc}
                  onChange={setCc}
                  placeholder="cc@example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="compose-bcc">BCC</Label>
                <EmailAutocomplete
                  id="compose-bcc"
                  value={bcc}
                  onChange={setBcc}
                  placeholder="bcc@example.com"
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
            <AiWriteToolbar
              mailboxId={effectiveFrom}
              body={body}
              subject={subject}
              onApply={setBody}
              onApplySubject={setSubject}
            />
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

        <div className="flex items-center gap-2 px-1">
          <Checkbox
            id="track-email"
            checked={trackEmail}
            onCheckedChange={(v) => setTrackEmail(!!v)}
          />
          <label
            htmlFor="track-email"
            className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none"
          >
            <Eye className="h-3.5 w-3.5" />
            Track email opens
          </label>
        </div>

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
