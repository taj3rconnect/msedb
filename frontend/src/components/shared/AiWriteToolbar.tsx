import { useState, useRef } from 'react';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCsrfToken } from '@/api/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

type AiAction = 'check-grammar' | 'write' | 'rewrite';

interface AiWriteToolbarProps {
  mailboxId: string;
  body: string;
  subject?: string;
  onApply: (text: string) => void;
  onApplySubject?: (subject: string) => void;
}

export function AiWriteToolbar({ mailboxId, body, subject = '', onApply, onApplySubject }: AiWriteToolbarProps) {
  const [running, setRunning] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  async function run(action: AiAction) {
    if (action !== 'write' && !body.trim()) {
      toast.error('Write something first');
      return;
    }

    setRunning(true);
    setStreaming(true);
    setSuggestion('');

    let accumulated = '';
    let aborted = false;

    abortRef.current = () => { aborted = true; };

    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch(`/api/mailboxes/${mailboxId}/ai-write`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action, body, subject }),
      });

      if (!res.ok || !res.body) {
        toast.error('AI write failed');
        setRunning(false);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        if (aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const obj = JSON.parse(line.slice(6)) as { token?: string; done?: boolean; error?: string };
            if (obj.error) { toast.error(obj.error); break; }
            if (obj.token) {
              accumulated += obj.token;
              setSuggestion(accumulated);
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      toast.error('AI write failed');
    }

    setStreaming(false);
    setRunning(false);

    // Strip <think>...</think> blocks that Qwen sometimes emits
    const clean = accumulated.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    setSuggestion(clean || null);
    if (!clean) toast.error('No result from AI');
  }

  function apply() {
    if (!suggestion) return;
    // Parse SUBJECT: line if present (only for "write" action)
    const subjectMatch = suggestion.match(/^SUBJECT:\s*(.+)\n/i);
    if (subjectMatch && onApplySubject) {
      onApplySubject(subjectMatch[1].trim());
      onApply(suggestion.replace(/^SUBJECT:\s*.+\n+/i, '').trim());
    } else {
      onApply(suggestion);
    }
    setSuggestion(null);
  }

  function dismiss() {
    abortRef.current?.();
    setSuggestion(null);
    setRunning(false);
    setStreaming(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
              disabled={running}
            >
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {running ? 'Thinking…' : 'AI Write'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => run('check-grammar')}>
              Fix grammar &amp; spelling
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run('write')}>
              Write with AI
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run('rewrite')} disabled={!body.trim()}>
              Rewrite with AI
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(suggestion !== null) && (
        <div className="rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {streaming ? 'Writing…' : 'AI suggestion'}
            </span>
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground max-h-48 overflow-y-auto">
            {suggestion}
            {streaming && <span className="inline-block w-1.5 h-3.5 bg-purple-500 animate-pulse ml-0.5 align-text-bottom" />}
          </pre>
          {!streaming && suggestion && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-6 text-xs" onClick={apply}>
                <Check className="h-3 w-3 mr-1" />
                Apply
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={dismiss}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
