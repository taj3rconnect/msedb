import { useState, useEffect } from 'react';
import { Sparkles, FileSpreadsheet, FileText, Send, Loader2, X } from 'lucide-react';
import { downloadSummaryCsv } from '@/api/events';
import { printSummary } from '@/lib/printSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// --- Summarize Loading State ---

const SUMMARY_MESSAGES = [
  "🔍 Digging through your inbox...",
  "📬 So many emails, so little time...",
  "🤖 AI is reading faster than you ever could...",
  "☕ Grab a coffee, this inbox is THICC...",
  "🧠 Teaching AI what 'urgent' really means...",
  "📊 Crunching numbers, dodging spam...",
  "🕵️ Hunting for emails that actually matter...",
  "💌 Sorting love letters from newsletters...",
  "🗑️ Resisting the urge to delete everything...",
  "🎯 Finding needles in your email haystack...",
  "📝 Writing your summary with extra sass...",
  "🚀 Almost there... probably...",
  "🤯 Wow, you get a LOT of email...",
  "🧹 Sweeping through the chaos...",
  "🎭 Judging your subscription choices...",
  "⏳ Still faster than reading them yourself...",
  "🔮 Predicting which ones you'll ignore...",
  "🏋️ Heavy lifting in progress...",
  "📖 Reading between the lines (literally)...",
  "🎪 Organizing this circus of an inbox...",
];

function SummarizeLoadingState({ onCancel }: { onCancel: () => void }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SUMMARY_MESSAGES.length);
    }, 3000);
    return () => clearInterval(msgTimer);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p
        key={messageIndex}
        className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        {SUMMARY_MESSAGES[messageIndex]}
      </p>
      <p className="text-xs text-muted-foreground/60 tabular-nums">{timeStr}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onCancel}
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Cancel
      </Button>
    </div>
  );
}

// --- Summarize Today Dialog ---

interface InboxSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryStats: { total: number; read: number; unread: number; deleted: number } | null;
  summaryContent: string;
  isPending: boolean;
  onCancel: () => void;
  mailboxId?: string;
  emailTo: string;
  onEmailToChange: (value: string) => void;
  showEmailForm: boolean;
  onToggleEmailForm: () => void;
  onSendEmail: () => void;
  isSending: boolean;
}

export function InboxSummaryDialog({
  open,
  onOpenChange,
  summaryStats,
  summaryContent,
  isPending,
  onCancel,
  mailboxId,
  emailTo,
  onEmailToChange,
  showEmailForm,
  onToggleEmailForm,
  onSendEmail,
  isSending,
}: InboxSummaryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Today's Email Summary
          </DialogTitle>
        </DialogHeader>
        {/* Stats bar */}
        {summaryStats && !isPending && (
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            <span className="font-semibold text-foreground">{summaryStats.total}</span> emails today
            {' — '}
            <span className="text-green-600 dark:text-green-400">{summaryStats.read} read</span>
            {', '}
            <span className="text-blue-600 dark:text-blue-400">{summaryStats.unread} unread</span>
            {summaryStats.deleted > 0 && (
              <>
                {', '}
                <span className="text-red-500 dark:text-red-400">{summaryStats.deleted} deleted</span>
              </>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto" id="summary-content">
          {isPending ? (
            <SummarizeLoadingState onCancel={onCancel} />
          ) : (
            <div
              className="prose prose-sm dark:prose-invert max-w-none [&_h3]:text-base [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_div]:py-0.5"
              dangerouslySetInnerHTML={{ __html: summaryContent }}
            />
          )}
        </div>
        {/* Email form */}
        {showEmailForm && (
          <div className="flex items-center gap-2 border rounded-md p-2 bg-muted/30">
            <Input
              placeholder="Recipient email"
              value={emailTo}
              onChange={(e) => onEmailToChange(e.target.value)}
              className="flex-1 h-8 text-sm"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={onSendEmail}
              disabled={isSending || !emailTo.trim() || !summaryContent}
            >
              {isSending ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3 w-3" />
              )}
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={onToggleEmailForm}
            >
              Cancel
            </Button>
          </div>
        )}
        <DialogFooter>
          {!isPending && summaryContent && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadSummaryCsv(mailboxId || undefined)}
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => printSummary(summaryContent, summaryStats)}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleEmailForm}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Email
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
