import { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { fetchAutocompleteSuggestions } from '@/api/mailboxes';
import { cn } from '@/lib/utils';

interface Suggestion {
  email: string;
  name?: string;
}

interface EmailAutocompleteProps {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  className?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailAutocomplete({
  value,
  onChange,
  placeholder = 'recipient@example.com',
  id,
  autoFocus,
  className,
}: EmailAutocompleteProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (query.trim().length < 2) {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const { suggestions: results } = await fetchAutocompleteSuggestions(query.trim());
          // Filter out already-added emails
          const existing = new Set(value.map((e) => e.toLowerCase()));
          const filtered = results.filter((s) => !existing.has(s.email.toLowerCase()));
          setSuggestions(filtered);
          setShowDropdown(filtered.length > 0);
          setActiveIndex(-1);
        } catch {
          setSuggestions([]);
          setShowDropdown(false);
        }
      }, 300);
    },
    [value],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const addEmail = useCallback(
    (email: string) => {
      const trimmed = email.trim();
      if (!trimmed) return;
      // Avoid duplicates
      if (value.some((e) => e.toLowerCase() === trimmed.toLowerCase())) return;
      onChange([...value, trimmed]);
      setInput('');
      setSuggestions([]);
      setShowDropdown(false);
      setActiveIndex(-1);
    },
    [value, onChange],
  );

  const removeEmail = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const commitInput = useCallback(() => {
    const trimmed = input.trim().replace(/[,;]+$/, '').trim();
    if (trimmed && EMAIL_RE.test(trimmed)) {
      addEmail(trimmed);
    }
  }, [input, addEmail]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (showDropdown && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        addEmail(suggestions[activeIndex].email);
      } else if (input.trim()) {
        e.preventDefault();
        commitInput();
      }
    } else if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeEmail(value.length - 1);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    fetchSuggestions(val);
  };

  const handleBlur = () => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      commitInput();
      setShowDropdown(false);
    }, 200);
  };

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 min-h-[36px] w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs transition-[color,box-shadow]',
          'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email, i) => (
          <span
            key={`${email}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium max-w-[240px]"
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              className="shrink-0 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                removeEmail(i);
              }}
              tabIndex={-1}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground py-0.5"
          placeholder={value.length === 0 ? placeholder : ''}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          autoFocus={autoFocus}
          autoComplete="off"
        />
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-[200px] overflow-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.email}
              type="button"
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors',
                i === activeIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur
                addEmail(s.email);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {s.name ? (
                <div className="flex flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.email}</span>
                </div>
              ) : (
                <span>{s.email}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
