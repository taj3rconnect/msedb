import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUiStore } from '@/stores/uiStore';
import { SHORTCUT_DEFS, formatShortcutKey } from '@/lib/keyboardShortcuts';

const GROUPS = ['Navigation', 'Inbox', 'General'] as const;

export function KeyboardShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {GROUPS.map((group) => {
            const defs = SHORTCUT_DEFS.filter((d) => d.group === group);
            if (defs.length === 0) return null;

            return (
              <div key={group} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group}
                </h3>
                <div className="space-y-1">
                  {defs.map((def) => (
                    <div
                      key={`${def.chord ?? ''}-${def.key}`}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{def.description}</span>
                      <div className="flex items-center gap-1">
                        {formatShortcutKey(def)
                          .split(' then ')
                          .map((part, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  then
                                </span>
                              )}
                              <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 text-xs font-mono font-medium text-muted-foreground">
                                {part}
                              </kbd>
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
