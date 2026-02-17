import { Mail, Shield, Brain, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/formatters';

interface StatsCardsProps {
  emailsProcessed: number;
  rulesFired: number;
  patternsPending: number;
  stagingCount: number;
}

const STAT_CARDS = [
  {
    key: 'emailsProcessed' as const,
    label: 'Emails Processed',
    icon: Mail,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
  },
  {
    key: 'rulesFired' as const,
    label: 'Rules Fired',
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950',
  },
  {
    key: 'patternsPending' as const,
    label: 'Patterns Pending',
    icon: Brain,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950',
  },
  {
    key: 'stagingCount' as const,
    label: 'In Staging',
    icon: Clock,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950',
  },
];

/**
 * Dashboard stats cards showing key metrics in a responsive grid.
 */
export function StatsCards(props: StatsCardsProps) {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
      {STAT_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              <div className={`rounded-md p-2 ${card.bgColor}`}>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(props[card.key])}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
