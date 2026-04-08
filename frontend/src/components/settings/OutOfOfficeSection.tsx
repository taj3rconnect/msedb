import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchOof, updateOof, type OofStatus, type MailboxInfo } from '@/api/settings';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

interface MailboxOofProps {
  mailbox: MailboxInfo;
}

function MailboxOof({ mailbox }: MailboxOofProps) {
  const [status, setStatus] = useState<OofStatus['status']>('Disabled');
  const [internalMsg, setInternalMsg] = useState('');
  const [externalMsg, setExternalMsg] = useState('');
  const [externalAudience, setExternalAudience] = useState<OofStatus['externalAudience']>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['oof', mailbox.id],
    queryFn: () => fetchOof(mailbox.id),
  });

  useEffect(() => {
    if (!data?.oof) return;
    const oof = data.oof;
    setStatus(oof.status);
    setInternalMsg(oof.internalReplyMessage ?? '');
    setExternalMsg(oof.externalReplyMessage ?? '');
    setExternalAudience(oof.externalAudience ?? 'all');
    if (oof.scheduledStartDateTime?.dateTime) {
      setStartDate(oof.scheduledStartDateTime.dateTime.slice(0, 16));
    }
    if (oof.scheduledEndDateTime?.dateTime) {
      setEndDate(oof.scheduledEndDateTime.dateTime.slice(0, 16));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (oof: Partial<OofStatus>) => updateOof(mailbox.id, oof),
    onSuccess: () => toast.success('Out-of-office settings saved'),
    onError: () => toast.error('Failed to save out-of-office settings'),
  });

  function handleSave() {
    const payload: Partial<OofStatus> = {
      status,
      internalReplyMessage: internalMsg,
      externalReplyMessage: externalMsg,
      externalAudience,
    };
    if (status === 'Scheduled' && startDate && endDate) {
      payload.scheduledStartDateTime = { dateTime: new Date(startDate).toISOString(), timeZone: 'UTC' };
      payload.scheduledEndDateTime = { dateTime: new Date(endDate).toISOString(), timeZone: 'UTC' };
    }
    mutation.mutate(payload);
  }

  if (isLoading) return <LoadingSpinner />;

  const enabled = status !== 'Disabled';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{mailbox.email}</CardTitle>
            <CardDescription>Automatic replies when you're away</CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => setStatus(v ? 'AlwaysEnabled' : 'Disabled')}
          />
        </div>
      </CardHeader>

      {enabled && (
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OofStatus['status'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AlwaysEnabled">Always on</SelectItem>
                <SelectItem value="Scheduled">Scheduled (date range)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {status === 'Scheduled' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reply to people inside your organization</Label>
            <Textarea
              value={internalMsg}
              onChange={(e) => setInternalMsg(e.target.value)}
              rows={3}
              placeholder="I'm currently out of office…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Reply to external senders</Label>
            <Select value={externalAudience} onValueChange={(v) => setExternalAudience(v as OofStatus['externalAudience'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Don't reply to external senders</SelectItem>
                <SelectItem value="contactsOnly">Reply to my contacts only</SelectItem>
                <SelectItem value="all">Reply to all external senders</SelectItem>
              </SelectContent>
            </Select>
            {externalAudience !== 'none' && (
              <Textarea
                value={externalMsg}
                onChange={(e) => setExternalMsg(e.target.value)}
                rows={3}
                placeholder="I'm currently out of office…"
                className="mt-2"
              />
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      )}

      {!enabled && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Toggle on to configure automatic replies.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

interface OutOfOfficeSectionProps {
  settings: { mailboxes: MailboxInfo[] };
}

export function OutOfOfficeSection({ settings }: OutOfOfficeSectionProps) {
  const { mailboxes } = settings;

  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No mailboxes connected.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => (
        <MailboxOof key={mailbox.id} mailbox={mailbox} />
      ))}
    </div>
  );
}
