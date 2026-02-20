import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Mailbox selector dropdown.
 *
 * Shows "All Mailboxes" plus the list of connected mailboxes from auth store.
 * Updates uiStore.selectedMailboxId on change.
 */
export function MailboxSelector() {
  const mailboxes = useAuthStore((s) => s.mailboxes);
  const selectedMailboxId = useUiStore((s) => s.selectedMailboxId);
  const setSelectedMailbox = useUiStore((s) => s.setSelectedMailbox);

  return (
    <Select
      value={selectedMailboxId ?? 'all'}
      onValueChange={(value) => setSelectedMailbox(value === 'all' ? null : value)}
    >
      <SelectTrigger className="w-[200px]" size="sm">
        <SelectValue placeholder="All Mailboxes" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Mailboxes</SelectItem>
        {mailboxes.map((mb) => (
          <SelectItem key={mb.id} value={mb.id}>
            {mb.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
