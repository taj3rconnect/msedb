import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { SenderBreakdownItem } from '@/api/events';

interface SenderBreakdownProps {
  data?: { breakdown: SenderBreakdownItem[] };
  isLoading: boolean;
}

const chartConfig = {
  count: {
    label: 'Events',
    color: 'oklch(0.6 0.18 250)',
  },
} satisfies ChartConfig;

/**
 * Horizontal bar chart showing top sender domains by event count.
 * Displays the top 10 from the 20 returned by the API.
 */
export function SenderBreakdown({ data, isLoading }: SenderBreakdownProps) {
  const chartData = useMemo(() => {
    if (!data?.breakdown) return [];
    return data.breakdown
      .slice(0, 10)
      .map((item) => ({
        domain: item._id ?? 'unknown',
        count: item.count,
      }));
  }, [data]);

  const truncateDomain = (value: string) => {
    if (value.length > 20) return `${value.slice(0, 17)}...`;
    return value;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Senders</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Senders</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No sender data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="domain"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={130}
                tickFormatter={truncateDomain}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => value}
                  />
                }
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
