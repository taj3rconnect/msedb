import { useEffect, useRef, useState } from 'react';
import { Search, AtSign, Globe } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSenderSuggestions } from '@/hooks/usePatterns';

interface PatternFiltersProps {
  status: string;
  patternType: string;
  ruleFilter: string;
  search: string;
  /** Mailbox scope for typeahead suggestions. */
  mailboxId?: string | null;
  onStatusChange: (status: string) => void;
  onPatternTypeChange: (type: string) => void;
  onRuleFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

export function PatternFilters({
  status,
  patternType,
  ruleFilter,
  search,
  mailboxId,
  onStatusChange,
  onPatternTypeChange,
  onRuleFilterChange,
  onSearchChange,
}: PatternFiltersProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: suggestions = [] } = useSenderSuggestions(search, mailboxId);

  // Close the suggestion list on any outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Reset the keyboard cursor whenever the suggestion set changes.
  useEffect(() => {
    setHighlighted(-1);
  }, [suggestions]);

  const showList = open && suggestions.length > 0;

  function commit(value: string) {
    onSearchChange(value);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      commit(suggestions[highlighted].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search with sender typeahead */}
      <div className="relative" ref={containerRef}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search sender, domain, subject..."
          className="pl-8 w-[260px] h-9 text-sm"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls="pattern-sender-suggestions"
          autoComplete="off"
        />
        {showList && (
          <ul
            id="pattern-sender-suggestions"
            role="listbox"
            className="absolute z-50 mt-1 w-[260px] max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.type}:${s.value}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseEnter={() => setHighlighted(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(s.value)}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                    i === highlighted ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  {s.type === 'email' ? (
                    <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{s.value}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="detected">Detected</SelectItem>
          <SelectItem value="suggested">Suggested</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      <Select value={patternType} onValueChange={onPatternTypeChange}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="sender">Sender</SelectItem>
          <SelectItem value="folder-routing">Folder Routing</SelectItem>
        </SelectContent>
      </Select>

      <Select value={ruleFilter} onValueChange={onRuleFilterChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Rules" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Rules</SelectItem>
          <SelectItem value="has-rule">Has Rule</SelectItem>
          <SelectItem value="no-rule">No Rule</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
