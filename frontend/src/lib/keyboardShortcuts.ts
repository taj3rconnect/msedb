/**
 * Static keyboard shortcut definitions (metadata only).
 * No actions attached here — actions are wired in the components that use `useKeyboardShortcuts`.
 */

export interface ShortcutDef {
  key: string;
  description: string;
  group: 'Navigation' | 'Inbox' | 'General';
  chord?: string; // e.g. 'g' means this fires as second key after 'g'
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Navigation chords (G then ...)
  { key: 'i', chord: 'g', group: 'Navigation', description: 'Go to Inbox' },
  { key: 'd', chord: 'g', group: 'Navigation', description: 'Go to Dashboard' },
  { key: 'a', chord: 'g', group: 'Navigation', description: 'Go to Activity' },
  { key: 'p', chord: 'g', group: 'Navigation', description: 'Go to Patterns' },
  { key: 'r', chord: 'g', group: 'Navigation', description: 'Go to Rules' },
  { key: 's', chord: 'g', group: 'Navigation', description: 'Go to Settings' },
  { key: 't', chord: 'g', group: 'Navigation', description: 'Go to Staging' },
  { key: 'u', chord: 'g', group: 'Navigation', description: 'Go to Audit' },

  // General
  { key: '?', group: 'General', description: 'Show keyboard shortcuts' },

  // Inbox
  { key: 'j', group: 'Inbox', description: 'Next email' },
  { key: 'k', group: 'Inbox', description: 'Previous email' },
  { key: 'Enter', group: 'Inbox', description: 'Open preview' },
  { key: 'o', group: 'Inbox', description: 'Open preview' },
  { key: 'x', group: 'Inbox', description: 'Toggle selection' },
  { key: 'e', group: 'Inbox', description: 'Archive / mark read' },
  { key: '#', group: 'Inbox', description: 'Delete email(s)' },
  { key: 'D', group: 'Inbox', description: 'Always delete (create rule)' },
  { key: 'I', group: 'Inbox', description: 'Mark as read' },
  { key: 'r', group: 'Inbox', description: 'Reply' },
  { key: 'f', group: 'Inbox', description: 'Forward' },
  { key: '/', group: 'Inbox', description: 'Focus search' },
  { key: 'Escape', group: 'Inbox', description: 'Close preview / deselect' },
];

/**
 * Format a shortcut for display (e.g. "G then I", "Shift+D", "#").
 */
export function formatShortcutKey(def: ShortcutDef): string {
  if (def.chord) {
    return `${def.chord.toUpperCase()} then ${def.key.toUpperCase()}`;
  }
  // Shift shortcuts are uppercase single letters
  if (def.key.length === 1 && def.key === def.key.toUpperCase() && def.key !== def.key.toLowerCase()) {
    return `Shift+${def.key}`;
  }
  // Special keys
  if (def.key === 'Enter' || def.key === 'Escape') return def.key;
  return def.key.toUpperCase();
}
