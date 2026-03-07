import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Search,
  Loader2,
  Paperclip,
  Star,
  Brain,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { aiSearch, type AiSearchResult, type AiSearchResponse } from '@/api/aiSearch';
import { formatDateTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AiSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxId?: string;
  onSelectResult: (result: AiSearchResult) => void;
}

export function AiSearchPanel({ open, onOpenChange, mailboxId, onSelectResult }: AiSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<AiSearchResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResponse(null);
    }
  }, [open]);

  const searchMutation = useMutation({
    mutationFn: () => aiSearch(query.trim(), mailboxId, 25),
    onSuccess: (data) => {
      setResponse(data);
    },
    onError: (err: Error) => {
      toast.error(`AI search failed: ${err.message}`);
    },
  });

  const handleSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searchMutation.isPending) {
      handleSearch();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4.5 w-4.5 text-purple-500" />
            AI Search
          </DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="p-4 pb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search in natural language... e.g. 'emails from Sneha about invoices'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9"
              disabled={searchMutation.isPending}
            />
          </div>
          <Button
            onClick={handleSearch}
            disabled={!query.trim() || searchMutation.isPending}
            className="shrink-0"
          >
            {searchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Parsed query info */}
        {response?.parsedQuery && (
          <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Parsed as:</span>
            {response.parsedQuery.senderFilter && (
              <Badge variant="secondary" className="text-xs h-5">
                from: {response.parsedQuery.senderFilter}
              </Badge>
            )}
            {response.parsedQuery.senderDomainFilter && (
              <Badge variant="secondary" className="text-xs h-5">
                domain: {response.parsedQuery.senderDomainFilter}
              </Badge>
            )}
            {response.parsedQuery.dateFrom && (
              <Badge variant="secondary" className="text-xs h-5">
                after: {response.parsedQuery.dateFrom}
              </Badge>
            )}
            {response.parsedQuery.dateTo && (
              <Badge variant="secondary" className="text-xs h-5">
                before: {response.parsedQuery.dateTo}
              </Badge>
            )}
            {response.parsedQuery.importanceFilter && (
              <Badge variant="secondary" className="text-xs h-5">
                importance: {response.parsedQuery.importanceFilter}
              </Badge>
            )}
            {response.parsedQuery.hasAttachments !== undefined && (
              <Badge variant="secondary" className="text-xs h-5">
                <Paperclip className="h-3 w-3 mr-0.5" />
                attachments
              </Badge>
            )}
            {response.parsedQuery.folderFilter && (
              <Badge variant="secondary" className="text-xs h-5">
                folder: {response.parsedQuery.folderFilter}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs h-5">
              <Zap className="h-3 w-3 mr-0.5" />
              "{response.parsedQuery.semanticQuery}"
            </Badge>
          </div>
        )}

        {/* Results area */}
        <div className="flex-1 min-h-0 overflow-auto border-t">
          {searchMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">Searching with AI...</p>
            </div>
          ) : response ? (
            response.results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Search className="h-8 w-8" />
                <p className="text-sm">No results found</p>
                <p className="text-xs">Try a different query or check if emails have been indexed</p>
              </div>
            ) : (
              <div className="divide-y">
                {response.results.map((result) => (
                  <button
                    key={result.id}
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      onSelectResult(result);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        {/* Subject */}
                        <div className="flex items-center gap-2">
                          {!result.isRead && (
                            <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">
                            {result.subject || '(no subject)'}
                          </span>
                        </div>

                        {/* Sender */}
                        <div className="text-xs text-muted-foreground truncate">
                          {result.senderName ? `${result.senderName} <${result.senderEmail}>` : result.senderEmail}
                        </div>

                        {/* Body snippet */}
                        {result.bodySnippet && (
                          <p className="text-xs text-muted-foreground/80 line-clamp-2">
                            {result.bodySnippet}
                          </p>
                        )}

                        {/* Badges */}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-muted-foreground/60">
                            {formatDateTime(result.receivedAt)}
                          </span>
                          {result.importance === 'high' && (
                            <Star className="h-3 w-3 text-amber-500" />
                          )}
                          {result.hasAttachments && (
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                          )}
                          {result.folder && (
                            <span className="text-[10px] text-muted-foreground/60 bg-muted px-1 rounded">
                              {result.folder}
                            </span>
                          )}
                          {result.categories.length > 0 && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {result.categories.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Score */}
                      <div className="shrink-0 text-right">
                        <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                          {(result.score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Brain className="h-10 w-10 text-purple-400/40" />
              <div className="text-center space-y-1">
                <p className="text-sm">Ask anything about your emails</p>
                <p className="text-xs text-muted-foreground/60">
                  Try: "invoices from last month" or "messages about project deadline"
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Timing footer */}
        {response?.timing && (
          <div className="border-t px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground/60 tabular-nums">
            <span>{response.results.length} result{response.results.length !== 1 ? 's' : ''}</span>
            <span className="h-3 w-px bg-border" />
            <span>Parse: {response.timing.parseMs}ms</span>
            <span>Embed: {response.timing.embedMs}ms</span>
            <span>Search: {response.timing.searchMs}ms</span>
            <span>Total: {response.timing.totalMs}ms</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
