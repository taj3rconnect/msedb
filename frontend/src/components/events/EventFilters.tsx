import { EVENT_TYPES } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EventFiltersProps {
  eventType: string;
  senderDomain: string;
  timelineRange: '24h' | '30d';
  onEventTypeChange: (value: string) => void;
  onSenderDomainChange: (value: string) => void;
  onTimelineRangeChange: (value: '24h' | '30d') => void;
}

/**
 * Filter controls for the email activity page.
 * Event type dropdown, sender domain text input, and timeline range toggle.
 */
export function EventFilters({
  eventType,
  senderDomain,
  timelineRange,
  onEventTypeChange,
  onSenderDomainChange,
  onTimelineRangeChange,
}: EventFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Event Type Filter */}
      <Select value={eventType} onValueChange={onEventTypeChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {Object.entries(EVENT_TYPES).map(([key, { label }]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sender Domain Filter */}
      <Input
        placeholder="Filter by sender domain..."
        value={senderDomain}
        onChange={(e) => onSenderDomainChange(e.target.value)}
        className="w-[220px]"
      />

      {/* Timeline Range Toggle */}
      <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
        <Button
          variant={timelineRange === '24h' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onTimelineRangeChange('24h')}
          className="h-7 px-3 text-xs"
        >
          24h
        </Button>
        <Button
          variant={timelineRange === '30d' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onTimelineRangeChange('30d')}
          className="h-7 px-3 text-xs"
        >
          30d
        </Button>
      </div>
    </div>
  );
}
