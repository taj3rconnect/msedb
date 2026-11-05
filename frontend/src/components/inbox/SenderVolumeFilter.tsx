import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SenderGroupBy } from '@/api/events';
import { parseMinSenderCount } from '@/lib/inboxFilters';

const TYPING_PAUSE_MS = 400;

const GROUP_OPTIONS: ReadonlyArray<readonly [SenderGroupBy, string, string]> = [
  ['sender', 'Sender', 'Count unread emails per email address'],
  ['domain', 'Domain', 'Count unread emails per domain'],
];

interface SenderVolumeFilterProps {
  minCount?: number;
  groupBy: SenderGroupBy;
  onMinCountChange: (minCount: number | undefined) => void;
  onGroupByChange: (groupBy: SenderGroupBy) => void;
}

/** "Unread from one sender, at least N": finds who is piling up in the inbox. */
export function SenderVolumeFilter({
  minCount,
  groupBy,
  onMinCountChange,
  onGroupByChange,
}: SenderVolumeFilterProps) {
  const [text, setText] = useState(minCount?.toString() ?? '');

  // Follow a change from outside, such as the reset button, without wiping a
  // partly typed value like "1" on its way to "12".
  useEffect(() => {
    setText((current) =>
      parseMinSenderCount(current) === minCount ? current : (minCount?.toString() ?? ''),
    );
  }, [minCount]);

  useEffect(() => {
    const typed = parseMinSenderCount(text);
    if (typed === minCount) return;
    const timer = setTimeout(() => onMinCountChange(typed), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, minCount, onMinCountChange]);

  return (
    <div className="flex items-center gap-1 ml-1">
      <label
        htmlFor="sender-volume-min"
        className="text-xs text-muted-foreground whitespace-nowrap"
        title="Show only unread emails from senders with at least this many unread"
      >
        At least
      </label>
      <input
        id="sender-volume-min"
        type="number"
        inputMode="numeric"
        min={2}
        step={1}
        placeholder="2+"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-7 w-14 rounded-md border bg-background px-1.5 text-right text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="text-xs text-muted-foreground whitespace-nowrap">unread per</span>
      {GROUP_OPTIONS.map(([key, label, title]) => (
        <Button
          key={key}
          variant={groupBy === key ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onGroupByChange(key)}
          title={title}
          aria-pressed={groupBy === key}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
