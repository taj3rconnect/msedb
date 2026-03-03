import { Settings } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { PatternSettingsSection } from '@/components/settings/PatternSettingsSection';
import { MailboxSection } from '@/components/settings/MailboxSection';
import { WhitelistSection } from '@/components/settings/WhitelistSection';
import { DataManagement } from '@/components/settings/DataManagement';
import { ContactsSection } from '@/components/settings/ContactsSection';
import { useSettings } from '@/hooks/useSettings';

/**
 * Settings page with tabbed sections.
 * Preferences tab replaced by Patterns tab (working hours + pattern engine config).
 */
export function SettingsPage() {
  const { data: settings, isLoading, isError } = useSettings();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isError || !settings) {
    return (
      <EmptyState
        icon={Settings}
        title="Failed to load settings"
        description="There was an error loading your settings. Please try again."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your preferences and account</p>
      </div>

      <Tabs defaultValue="patterns">
        <TabsList>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
          <TabsTrigger value="whitelists">Whitelists</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="patterns">
          <PatternSettingsSection settings={settings} />
        </TabsContent>

        <TabsContent value="mailboxes">
          <MailboxSection settings={settings} />
        </TabsContent>

        <TabsContent value="whitelists">
          <WhitelistSection settings={settings} />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsSection settings={settings} />
        </TabsContent>

        <TabsContent value="data">
          <DataManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
