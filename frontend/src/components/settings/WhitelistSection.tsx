import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWhitelist } from '@/hooks/useSettings';
import type { SettingsResponse, MailboxInfo } from '@/api/settings';

/**
 * Parse a textarea value into a clean array of strings.
 * Splits on newlines, trims whitespace, and filters empty strings.
 */
function parseTextareaList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface MailboxWhitelistProps {
  mailbox: MailboxInfo;
}

function MailboxWhitelist({ mailbox }: MailboxWhitelistProps) {
  const updateWhitelist = useUpdateWhitelist();

  const [senders, setSenders] = useState(mailbox.whitelistedSenders.join('\n'));
  const [domains, setDomains] = useState(mailbox.whitelistedDomains.join('\n'));

  // Sync when data refreshes
  useEffect(() => {
    setSenders(mailbox.whitelistedSenders.join('\n'));
    setDomains(mailbox.whitelistedDomains.join('\n'));
  }, [mailbox.whitelistedSenders, mailbox.whitelistedDomains]);

  const currentSenders = parseTextareaList(senders);
  const currentDomains = parseTextareaList(domains);

  const hasChanges =
    JSON.stringify(currentSenders) !== JSON.stringify(mailbox.whitelistedSenders) ||
    JSON.stringify(currentDomains) !== JSON.stringify(mailbox.whitelistedDomains);

  function handleSave() {
    updateWhitelist.mutate({
      mailboxId: mailbox.id,
      data: {
        whitelistedSenders: currentSenders,
        whitelistedDomains: currentDomains,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{mailbox.email}</CardTitle>
        <CardDescription>
          Emails from whitelisted senders and domains will never be auto-actioned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Whitelisted Senders (one email per line)</Label>
          <Textarea
            value={senders}
            onChange={(e) => setSenders(e.target.value)}
            placeholder="user@example.com&#10;important@company.com"
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label>Whitelisted Domains (one domain per line)</Label>
          <Textarea
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="example.com&#10;important-company.com"
            rows={4}
          />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateWhitelist.isPending}
            size="sm"
          >
            {updateWhitelist.isPending ? 'Saving...' : 'Save Whitelist'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface WhitelistSectionProps {
  settings: SettingsResponse;
}

/**
 * Whitelists tab allowing per-mailbox sender and domain whitelist editing.
 */
export function WhitelistSection({ settings }: WhitelistSectionProps) {
  const { mailboxes } = settings;

  if (mailboxes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No mailboxes connected. Connect a mailbox to manage whitelists.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mailboxes.map((mailbox) => (
        <MailboxWhitelist key={mailbox.id} mailbox={mailbox} />
      ))}
    </div>
  );
}
