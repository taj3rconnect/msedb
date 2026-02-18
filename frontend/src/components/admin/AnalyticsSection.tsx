import { Users, UserCheck, Mail, Shield, Brain } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminAnalytics } from '@/hooks/useAdmin';
import { formatNumber } from '@/lib/formatters';

const STAT_CARDS = [
  {
    key: 'totalUsers' as const,
    label: 'Total Users',
    icon: Users,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  {
    key: 'activeUsers' as const,
    label: 'Active Users',
    icon: UserCheck,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950',
  },
  {
    key: 'totalEvents' as const,
    label: 'Total Events',
    icon: Mail,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950',
  },
  {
    key: 'totalRules' as const,
    label: 'Active Rules',
    icon: Shield,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950',
  },
  {
    key: 'totalPatterns' as const,
    label: 'Pending Patterns',
    icon: Brain,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950',
  },
];

/**
 * Analytics section showing 5 aggregate stat cards in a responsive grid.
 * Follows the DashboardPage StatsCards pattern.
 */
export function AnalyticsSection() {
  const { data, isLoading } = useAdminAnalytics();

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon;
        const value = data?.[card.key] ?? 0;
        return (
          <Card key={card.key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              <div className={`rounded-md p-2 ${card.bgColor}`}>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(value)}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
