import { Bell } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRulePopupStore } from '@/stores/rulePopupStore';

export function RulePopupModal() {
  const popup = useRulePopupStore((s) => s.popup);
  const dismissPopup = useRulePopupStore((s) => s.dismissPopup);

  return (
    <Dialog open={!!popup} onOpenChange={(open) => { if (!open) dismissPopup(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-500" />
            Email Alert
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-base font-medium">{popup?.message}</p>
          {popup?.sender && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">From:</span> {popup.sender}
            </p>
          )}
          {popup?.subject && (
            <p className="text-sm text-muted-foreground truncate">
              <span className="font-medium">Subject:</span> {popup.subject}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={dismissPopup}>Dismiss</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
