import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdatePreferences } from '@/hooks/useSettings';
import { fetchContactFolders } from '@/api/mailboxes';
import type { SettingsResponse } from '@/api/settings';

interface ContactsSectionProps {
  settings: SettingsResponse;
}

export function ContactsSection({ settings }: ContactsSectionProps) {
  const updatePreferences = useUpdatePreferences();
  const prefs = settings.user.preferences;
  const connectedMailboxes = settings.mailboxes.filter((m) => m.isConnected);

  const [selectedMailboxId, setSelectedMailboxId] = useState(prefs.contactsMailboxId ?? '');
  const [selectedFolderId, setSelectedFolderId] = useState(prefs.contactsFolderId ?? '');

  // Sync local state when settings change
  useEffect(() => {
    setSelectedMailboxId(prefs.contactsMailboxId ?? '');
    setSelectedFolderId(prefs.contactsFolderId ?? '');
  }, [prefs.contactsMailboxId, prefs.contactsFolderId]);

  // Fetch contact folders when a mailbox is selected
  const { data: folderData, isLoading: foldersLoading, isError, error, isFetching } = useQuery({
    queryKey: ['contact-folders', selectedMailboxId],
    queryFn: () => fetchContactFolders(selectedMailboxId),
    enabled: !!selectedMailboxId,
    staleTime: 0,
    retry: false,
  });

  const folders = folderData?.folders ?? [];

  const hasChanges =
    selectedMailboxId !== (prefs.contactsMailboxId ?? '') ||
    selectedFolderId !== (prefs.contactsFolderId ?? '');

  function handleMailboxChange(mailboxId: string) {
    setSelectedMailboxId(mailboxId);
    setSelectedFolderId(''); // reset folder when mailbox changes
  }

  function handleSave() {
    updatePreferences.mutate({
      contactsMailboxId: selectedMailboxId,
      contactsFolderId: selectedFolderId,
    });
  }

  return (
    <div className="space-y-6">
      {/* Mailbox Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Source</CardTitle>
          <CardDescription>
            Choose which mailbox and contact folder to use for contact search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Mailbox</Label>
            <Select value={selectedMailboxId} onValueChange={handleMailboxChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a mailbox" />
              </SelectTrigger>
              <SelectContent>
                {connectedMailboxes.map((mb) => (
                  <SelectItem key={mb.id} value={mb.id}>
                    {mb.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Contact Folder Selection */}
      {selectedMailboxId && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Folder</CardTitle>
            <CardDescription>
              Select which contact folder to search from.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(foldersLoading || isFetching) ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="flex items-start gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Failed to load contact folders</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Make sure Contacts.Read permission is granted and admin-consented in Azure Portal,
                    then disconnect and reconnect this mailbox.
                  </p>
                </div>
              </div>
            ) : folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contact folders found in this mailbox.</p>
            ) : (
              <RadioGroup value={selectedFolderId} onValueChange={setSelectedFolderId}>
                {folders.map((folder) => (
                  <div key={folder.id} className="flex items-center space-x-3 py-2">
                    <RadioGroupItem value={folder.id} id={`folder-${folder.id}`} />
                    <Label htmlFor={`folder-${folder.id}`} className="cursor-pointer font-medium flex-1">
                      {folder.displayName}
                    </Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {folder.totalCount} contact{folder.totalCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </RadioGroup>
            )}
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || !selectedMailboxId || !selectedFolderId || updatePreferences.isPending}
        >
          {updatePreferences.isPending ? 'Saving...' : 'Save Contact Settings'}
        </Button>
      </div>
    </div>
  );
}
