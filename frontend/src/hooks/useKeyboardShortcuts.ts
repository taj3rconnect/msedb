import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export interface Shortcut {
  /** The key to match (e.g. 'j', 'Enter', '?', '#'). For Shift shortcuts use uppercase letter (e.g. 'D'). */
  key: string;
  /** If set, this shortcut requires a chord prefix (e.g. chord='g' means press 'g' then this key). */
  chord?: string;
  /** Whether Ctrl/Cmd must be held. */
  ctrl?: boolean;
  /** The handler to invoke. */
  action: () => void;
}

/**
 * Check if the user is typing in an input/textarea/contenteditable.
 */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Core keyboard shortcut hook.
 *
 * Handles single-key shortcuts, Ctrl+key combos, and two-key chords
 * (e.g. press 'g' then 'i' within 1.5s to navigate).
 *
 * The shortcuts array should be stable (wrap in useRef or useMemo).
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  const pendingChord = useRef<string | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync without re-registering listener
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const clearChord = useCallback(() => {
    pendingChord.current = null;
    if (chordTimer.current) {
      clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when user is typing in form fields
      if (isTyping()) {
        // Exception: Escape should still work
        if (e.key !== 'Escape') return;
      }

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;

      // If we have a pending chord, try to match chord shortcuts
      if (pendingChord.current) {
        const chord = pendingChord.current;
        clearChord();

        for (const s of shortcutsRef.current) {
          if (s.chord === chord && s.key === key.toLowerCase()) {
            e.preventDefault();
            s.action();
            return;
          }
        }
        // No chord match — fall through to check single-key shortcuts
      }

      // Check if this key starts a chord
      const chordStarters = new Set(
        shortcutsRef.current
          .filter((s) => s.chord)
          .map((s) => s.chord!),
      );

      if (!ctrl && chordStarters.has(key.toLowerCase())) {
        // Don't start chord if shift is held (would conflict with single-key shortcuts like Shift+D)
        if (!e.shiftKey) {
          e.preventDefault();
          pendingChord.current = key.toLowerCase();
          chordTimer.current = setTimeout(() => {
            pendingChord.current = null;
            chordTimer.current = null;
          }, 1500);
          toast(`${key.toUpperCase()}...`, { duration: 1500, id: 'chord-hint' });
          return;
        }
      }

      // Single-key and Ctrl+key shortcuts
      for (const s of shortcutsRef.current) {
        if (s.chord) continue; // chord shortcuts handled above

        const matchKey = s.key === key || (s.key.length === 1 && s.key === key);
        const matchCtrl = s.ctrl ? ctrl : !ctrl;

        if (matchKey && matchCtrl) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearChord();
    };
  }, [clearChord]);
}
