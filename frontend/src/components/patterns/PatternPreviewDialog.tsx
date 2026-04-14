import { useState, useEffect } from 'react';
import { Loader2, Mail, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { fetchPatternMessages, fetchPatternMessage } from '@/api/patterns';
import type { PreviewMessage, PreviewMessageFull } from '@/api/patterns';

interface PatternPreviewDialogProps {
  patternId: string | null;
  senderLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PatternPreviewDialog({
  patternId,
  senderLabel,
  open,
  onOpenChange,
}: PatternPreviewDialogProps) {
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullMessage, setFullMessage] = useState<PreviewMessageFull | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  // Fetch message list when dialog opens
  useEffect(() => {
    if (!open || !patternId) return;
    setMessages([]);
    setSelectedId(null);
    setFullMessage(null);
    setError(null);
    setLoading(true);

    fetchPatternMessages(patternId)
      .then((msgs) => setMessages(msgs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load messages'))
      .finally(() => setLoading(false));
  }, [open, patternId]);

  // Fetch full message when selected
  useEffect(() => {
    if (!selectedId || !patternId) return;
    setFullMessage(null);
    setLoadingFull(true);

    fetchPatternMessage(patternId, selectedId)
      .then((msg) => setFullMessage(msg))
      .catch(() => setFullMessage(null))
      .finally(() => setLoadingFull(false));
  }, [selectedId, patternId]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Recent emails from {senderLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
          {/* Left: message list */}
          <div className="w-2/5 border rounded-md overflow-y-auto shrink-0">
            {loading ? (
              <div className="flex items-center justify-center h-full p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-red-600">{error}</div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No recent messages found.</div>
            ) : (
              messages.map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => setSelectedId(msg.id)}
                  className={`w-full text-left p-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors ${
                    selectedId === msg.id ? 'bg-muted' : ''
                  }`}
                >
                  <p className="text-sm font-medium truncate">{msg.subject || '(no subject)'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground">{formatDate(msg.receivedDateTime)}</p>
                    {msg._fromDeletedItems && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-orange-600 dark:text-orange-400">
                        <Trash2 className="h-3 w-3" />
                        Deleted
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right: message body */}
          <div className="flex-1 border rounded-md overflow-y-auto p-4">
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">Select a message to preview.</p>
            ) : loadingFull ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : fullMessage ? (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm">{fullMessage.subject}</h3>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>From: {fullMessage.from.emailAddress.name} &lt;{fullMessage.from.emailAddress.address}&gt;</p>
                  <p>{formatDate(fullMessage.receivedDateTime)}</p>
                </div>
                <hr />
                {fullMessage.body.contentType === 'html' ? (
                  <div
                    className="text-sm prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: fullMessage.body.content }}
                  />
                ) : (
                  <pre className="text-sm whitespace-pre-wrap">{fullMessage.body.content}</pre>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load message.</p>
            )}
          </div>
        </div>

        <DialogFooter showCloseButton>
          {/* Close button handled by showCloseButton */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
