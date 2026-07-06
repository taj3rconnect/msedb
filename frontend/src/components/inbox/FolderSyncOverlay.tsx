import { useState, useEffect } from 'react';
import { Mail, RefreshCw, Trash2, Inbox, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SyncProgress } from '@/api/mailboxes';

const SYNC_MESSAGES = [
  "📡 Beaming down your emails from the cloud...",
  "📮 Your mailbox is spilling its secrets...",
  "🏃 Chasing emails at the speed of light...",
  "🧲 Magnetically attracting your messages...",
  "🎣 Fishing for emails in the Microsoft ocean...",
  "🚚 Mail truck incoming, honk honk!",
  "🌊 Surfing the email wave...",
  "🐝 Busy bees fetching your honey... er, mail...",
  "🏗️ Building your email empire, one message at a time...",
  "🎰 Every message is a winner!",
  "📦 Unpacking your digital mail bag...",
  "🛸 Downloading emails from the mothership...",
  "⚡ Electrons carrying your precious messages...",
  "🎁 Unwrapping emails like birthday presents...",
  "🧙 Conjuring messages from the Graph API void...",
  "🐌 Just kidding, we're actually pretty fast...",
  "🎪 Step right up! Watch the emails appear!",
  "🍿 Sit back, relax, enjoy the sync show...",
  "🦅 Emails soaring in from Microsoft HQ...",
  "🔬 Carefully examining each message...",
];

export function FolderSyncOverlay({
  progress,
  onCancel,
}: {
  progress: SyncProgress | null;
  onCancel: () => void;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SYNC_MESSAGES.length);
    }, 3000);
    return () => clearInterval(msgTimer);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

  const total = progress
    ? progress.created + progress.updated + progress.deleted + progress.skipped
    : 0;

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5">
      {/* Animated mail icon */}
      <div className="relative">
        <Mail className="h-12 w-12 text-primary animate-bounce" />
        {total > 0 && (
          <span className="absolute -top-2 -right-3 bg-primary text-primary-foreground text-xs font-bold rounded-full h-6 min-w-6 flex items-center justify-center px-1.5 animate-in zoom-in duration-200">
            {total}
          </span>
        )}
      </div>

      {/* Funny rotating message */}
      <p
        key={messageIndex}
        className="text-base text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-300 text-center max-w-md"
      >
        {SYNC_MESSAGES[messageIndex]}
      </p>

      {/* Progress stats */}
      {progress && (
        <div className="flex items-center gap-4 text-sm tabular-nums">
          {progress.created > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Inbox className="h-3.5 w-3.5" />
              {progress.created} new
            </span>
          )}
          {progress.updated > 0 && (
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <RefreshCw className="h-3.5 w-3.5" />
              {progress.updated} updated
            </span>
          )}
          {progress.deleted > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
              {progress.deleted} removed
            </span>
          )}
          {progress.pageMessages > 0 && (
            <span className="text-muted-foreground">
              ({progress.pageMessages} in last batch)
            </span>
          )}
        </div>
      )}

      {/* Elapsed time */}
      <p className="text-xs text-muted-foreground/60 tabular-nums">{timeStr}</p>

      {/* Cancel button */}
      <Button
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={onCancel}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Stop Sync
      </Button>
    </div>
  );
}
