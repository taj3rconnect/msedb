import { cn } from '@/lib/utils';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

interface AlphabetIndexProps {
  availableLetters: Set<string>;
  activeLetter: string;
  onLetterClick: (letter: string) => void;
}

export function AlphabetIndex({ availableLetters, activeLetter, onLetterClick }: AlphabetIndexProps) {
  return (
    <nav className="flex flex-col items-center gap-0.5 py-1 select-none">
      {LETTERS.map((letter) => {
        const hasContacts = availableLetters.has(letter);
        const isActive = activeLetter === letter;
        return (
          <button
            key={letter}
            onClick={() => hasContacts && onLetterClick(letter)}
            className={cn(
              'text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded transition-colors',
              hasContacts
                ? isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-muted'
                : 'text-muted-foreground/30 cursor-default',
            )}
            disabled={!hasContacts}
          >
            {letter}
          </button>
        );
      })}
    </nav>
  );
}
