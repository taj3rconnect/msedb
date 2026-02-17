import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { format, parseISO } from 'date-fns';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { TimelineBucket } from '@/api/events';

interface EventTimelineProps {
  data?: { timeline: TimelineBucket[]; range: string };
  isLoading: boolean;
}

const chartConfig = {
  count: {
    label: 'Events',
    color: 'oklch(0.646 0.222 41.116)',
  },
} satisfies ChartConfig;

/**
 * Area chart showing email event counts over time.
 * Supports 24h (hourly) and 30d (daily) ranges.
 */
export function EventTimeline({ data, isLoading }: EventTimelineProps) {
  const chartData = useMemo(() => {
    if (!data?.timeline) return [];
    return data.timeline.map((bucket) => ({
      timeBucket: bucket._id,
      count: bucket.count,
    }));
  }, [data]);

  const range = data?.range ?? '24h';

  const formatXAxis = (value: string) => {
    try {
      if (range === '24h') {
        // Format: "2026-02-17T14:00" -> "14:00"
        const date = parseISO(value);
        return format(date, 'HH:00');
      }
      // Format: "2026-02-17" -> "Feb 17"
      const date = parseISO(value);
      return format(date, 'MMM dd');
    } catch {
      return value;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Timeline</CardTitle>
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
        <CardTitle className="text-base">Event Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No data for selected period
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timeBucket"
                tickFormatter={formatXAxis}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      if (range === '24h') {
                        try {
                          return format(parseISO(value), 'MMM dd, HH:00');
                        } catch {
                          return value;
                        }
                      }
                      try {
                        return format(parseISO(value), 'MMMM dd, yyyy');
                      } catch {
                        return value;
                      }
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-count)"
                fill="var(--color-count)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
