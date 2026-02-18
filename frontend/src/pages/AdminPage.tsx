import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagement } from '@/components/admin/UserManagement';
import { OrgRulesSection } from '@/components/admin/OrgRulesSection';
import { AnalyticsSection } from '@/components/admin/AnalyticsSection';
import { SystemHealthSection } from '@/components/admin/SystemHealthSection';

/**
 * Admin Panel page with 4 tabbed sections:
 * - Users: invite, role management, deactivation
 * - Org Rules: create and delete org-wide rules
 * - Analytics: aggregate stats
 * - System Health: webhook subscriptions and token health
 *
 * Route-level guard in App.tsx ensures only admin users reach this page.
 */
export function AdminPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        <p className="text-muted-foreground">
          Manage users, org-wide rules, and system health
        </p>
      </div>

      {/* Tabbed Sections */}
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="org-rules">Org Rules</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="system-health">System Health</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>

        <TabsContent value="org-rules">
          <OrgRulesSection />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsSection />
        </TabsContent>

        <TabsContent value="system-health">
          <SystemHealthSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
