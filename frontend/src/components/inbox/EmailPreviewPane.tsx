import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Mail,
  MailOpen,
  Star,
  Tag,
  Paperclip,
  Reply,
  ReplyAll,
  Forward,
  Send,
  MailCheck,
  Trash2,
  ListFilter,
  X,
  Eye,
  ImageOff,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import type { EventItem } from '@/api/events';
import { fetchMessageBody, replyToMessage, replyAllToMessage, forwardMessage } from '@/api/mailboxes';
import { ApiError } from '@/api/client';
import { fetchRules } from '@/api/rules';
import { formatDateTime, highlightText } from '@/lib/formatters';
import { EmailAutocomplete } from '@/components/inbox/EmailAutocomplete';
import { AiWriteToolbar } from '@/components/shared/AiWriteToolbar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// --- HTML Email Viewer ---

function HtmlEmailViewer({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(500);
  const [showImages, setShowImages] = useState(true);

  // Reset height when email changes
  useEffect(() => {
    setIframeHeight(500);
    setShowImages(true);
  }, [html]);

  const processedHtml = useMemo(() => {
    let content = html;

    // Make all links open in new tab
    content = content.replace(/<a(\s)/gi, '<a target="_blank" rel="noopener noreferrer"$1');

    // Use CSS to hide images rather than mangling src attributes (avoids empty broken boxes)
    const imageBlockCss = showImages ? '' : 'img{display:none!important;}';

    // Inject responsive styles
    const injectStyles = `<style>
html,body{margin:0!important;padding:12px!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif!important;font-size:14px!important;line-height:1.5!important;color:#111!important;background:#fff!important;word-wrap:break-word!important;overflow-x:hidden!important;}
img{max-width:100%!important;height:auto!important;}
table{max-width:100%!important;}
*{box-sizing:border-box!important;}
a{color:#0078d4;}
pre,code{white-space:pre-wrap!important;word-break:break-all!important;}
${imageBlockCss}
</style>`;

    if (content.includes('</head>')) {
      return content.replace('</head>', `${injectStyles}</head>`);
    }
    if (content.toLowerCase().includes('<html')) {
      return content.replace(/<html([^>]*)>/i, `<html$1><head>${injectStyles}</head>`);
    }
    return injectStyles + content;
  }, [html, showImages]);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 0;
        if (h > 0) setIframeHeight(h + 24);
      }
    } catch {
      // cross-origin fallback — keep default height
    }
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowImages((v) => !v)}
        >
          {showImages ? <ImageOff className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {showImages ? 'Hide images' : 'Show images'}
        </button>
      </div>
      <div className="rounded border overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          srcDoc={processedHtml}
          className="w-full border-0 block"
          style={{ height: `${iframeHeight}px` }}
          sandbox="allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          title="Email content"
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}

// --- Email Preview Pane ---

interface EmailPreviewPaneProps {
  event: EventItem;
  mailboxId: string;
  position: 'right' | 'bottom';
  onClose: () => void;
  onJustDelete: (event: EventItem) => void;
  onMarkRead: (event: EventItem) => void;
  onQuickDelete: (event: EventItem) => void;
  onQuickMarkRead: (event: EventItem) => void;
  onAction: (event: EventItem) => void;
  searchQuery?: string;
}

export function EmailPreviewPane({
  event,
  mailboxId,
  onClose,
  onJustDelete,
  onMarkRead,
  onQuickDelete,
  onQuickMarkRead,
  onAction,
  searchQuery = '',
}: EmailPreviewPaneProps) {
  const timeStr = formatDateTime(event.timestamp);

  // Compose mode: reply, replyAll, forward, or null
  const [composeMode, setComposeMode] = useState<'reply' | 'replyAll' | 'forward' | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [forwardTo, setForwardTo] = useState<string[]>([]);
  const [replyCC, setReplyCC] = useState<string[]>([]);
  const [replyBCC, setReplyBCC] = useState<string[]>([]);
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [trackReply, setTrackReply] = useState(true);

  // Reset compose mode when switching emails
  useEffect(() => {
    setComposeMode(null);
    setComposeBody('');
    setForwardTo([]);
    setReplyCC([]);
    setReplyBCC([]);
    setShowCC(false);
    setShowBCC(false);
    setTrackReply(true);
  }, [event._id]);

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: () => replyToMessage(mailboxId, event.messageId, composeBody, replyCC, replyBCC, trackReply),
    onSuccess: () => {
      toast.success('Reply sent');
      setComposeMode(null);
      setComposeBody('');
      setReplyCC([]);
      setReplyBCC([]);
      setShowCC(false);
      setShowBCC(false);
    },
    onError: (err: Error) => {
      toast.error(`Reply failed: ${err.message}`);
    },
  });

  // Reply All mutation
  const replyAllMutation = useMutation({
    mutationFn: () => replyAllToMessage(mailboxId, event.messageId, composeBody, replyCC, replyBCC, trackReply),
    onSuccess: () => {
      toast.success('Reply-all sent');
      setComposeMode(null);
      setComposeBody('');
      setReplyCC([]);
      setReplyBCC([]);
      setShowCC(false);
      setShowBCC(false);
    },
    onError: (err: Error) => {
      toast.error(`Reply-all failed: ${err.message}`);
    },
  });

  // Forward mutation
  const forwardMutation = useMutation({
    mutationFn: () => {
      const recipients = forwardTo.map((email) => ({ email }));
      return forwardMessage(mailboxId, event.messageId, recipients, composeBody);
    },
    onSuccess: () => {
      toast.success('Message forwarded');
      setComposeMode(null);
      setComposeBody('');
      setForwardTo([]);
    },
    onError: (err: Error) => {
      toast.error(`Forward failed: ${err.message}`);
    },
  });

  // Fetch the full email body from Graph API
  const { data: bodyData, isLoading: bodyLoading, isError: bodyError, error: bodyFetchError } = useQuery({
    queryKey: ['message-body', mailboxId, event.messageId],
    queryFn: () => fetchMessageBody(mailboxId, event.messageId),
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
    retry: false,
  });

  const messageBody = bodyData?.message?.body;

  // Check if any rules match this sender
  const { data: rulesData } = useQuery({
    queryKey: ['rules', mailboxId],
    queryFn: () => fetchRules({ mailboxId, limit: 200 }),
    staleTime: 30 * 1000,
  });

  const senderEmail = event.sender.email?.toLowerCase();
  const matchingRules = useMemo(() => {
    if (!rulesData?.rules || !senderEmail) return [];
    return rulesData.rules.filter((rule) => {
      const cond = rule.conditions.senderEmail;
      if (!cond) return false;
      const emails = Array.isArray(cond) ? cond : [cond];
      return emails.some((e) => e.toLowerCase() === senderEmail);
    });
  }, [rulesData, senderEmail]);

  const hasDeleteRule = matchingRules.some((r) =>
    r.actions.some((a) => a.actionType === 'delete'),
  );
  const hasMarkReadRule = matchingRules.some((r) =>
    r.actions.some((a) => a.actionType === 'markRead'),
  );

  const isSending = replyMutation.isPending || replyAllMutation.isPending || forwardMutation.isPending;

  return (
    <Card className="h-full border-0 shadow-none rounded-none flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug break-words" dangerouslySetInnerHTML={{
            __html: highlightText(event.subject || '(no subject)', searchQuery),
          }} />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col space-y-4 overflow-auto">
        {/* Sender */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              {event.sender.name && (
                <div className="font-medium text-sm truncate" dangerouslySetInnerHTML={{
                  __html: highlightText(event.sender.name, searchQuery),
                }} />
              )}
              <div className="text-xs text-muted-foreground truncate" dangerouslySetInnerHTML={{
                __html: highlightText(event.sender.email || 'Unknown sender', searchQuery),
              }} />
            </div>
          </div>
        </div>

        {/* To recipients */}
        {bodyData?.message?.toRecipients && bodyData.message.toRecipients.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">To:</span>{' '}
            {bodyData.message.toRecipients.map((r, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address}
              </span>
            ))}
          </div>
        )}

        {/* CC recipients */}
        {bodyData?.message?.ccRecipients && bodyData.message.ccRecipients.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">CC:</span>{' '}
            {bodyData.message.ccRecipients.map((r, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted-foreground">{timeStr}</span>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {event.isRead ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <MailOpen className="h-3 w-3" /> Read
            </span>
          ) : (
            <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
              Unread
            </span>
          )}
          {event.importance === 'high' && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                <Star className="h-3 w-3" /> High Priority
              </span>
            </>
          )}
          {event.hasAttachments && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-muted-foreground flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> Attachments
              </span>
            </>
          )}
          {event.categories.length > 0 && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <span className="text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" /> {event.categories.join(', ')}
              </span>
            </>
          )}
        </div>

        {/* Folder info */}
        {(event.fromFolder || event.toFolder) && (
          <div className="text-xs text-muted-foreground">
            Folder: {event.toFolder || event.fromFolder}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'reply' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'reply' ? null : 'reply');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <Reply className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'replyAll' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'replyAll' ? null : 'replyAll');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <ReplyAll className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={composeMode === 'forward' ? 'default' : 'outline'}
                className="h-7 w-7"
                onClick={() => {
                  setComposeMode(composeMode === 'forward' ? null : 'forward');
                  setComposeBody('');
                  setForwardTo([]);
                }}
              >
                <Forward className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => onJustDelete(event)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => onMarkRead(event)}
                disabled={event.isRead}
              >
                <MailCheck className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{event.isRead ? 'Already read' : 'Mark as read'}</TooltipContent>
          </Tooltip>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${hasDeleteRule ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onQuickDelete(event)}
            disabled={!event.sender.email}
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            {hasDeleteRule ? 'Delete Rule Active' : 'Always Delete'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${hasMarkReadRule ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onQuickMarkRead(event)}
            disabled={!event.sender.email}
          >
            <MailOpen className="mr-1.5 h-3 w-3" />
            {hasMarkReadRule ? 'Mark Read Rule Active' : 'Always Mark Read'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs ${matchingRules.length > 0 ? 'bg-yellow-100 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : ''}`}
            onClick={() => onAction(event)}
          >
            <ListFilter className="mr-1.5 h-3 w-3" />
            {matchingRules.length > 0 ? `${matchingRules.length} Rule${matchingRules.length > 1 ? 's' : ''} Active` : 'Create Rule'}
          </Button>
        </div>

        {/* Compose area (Reply / Reply All / Forward) */}
        {composeMode && (
          <div className="border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="text-sm font-medium">
              {composeMode === 'reply' ? 'Reply' : composeMode === 'replyAll' ? 'Reply All' : 'Forward'}
            </div>

            {(composeMode === 'reply' || composeMode === 'replyAll') && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    To: {composeMode === 'replyAll' ? 'All recipients' : (event.sender.email || 'Unknown')}
                  </span>
                  <div className="flex items-center gap-1 ml-auto">
                    {!showCC && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        onClick={() => setShowCC(true)}
                      >
                        CC
                      </button>
                    )}
                    {!showBCC && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        onClick={() => setShowBCC(true)}
                      >
                        BCC
                      </button>
                    )}
                  </div>
                </div>
                {showCC && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">CC:</span>
                    <EmailAutocomplete
                      autoFocus
                      value={replyCC}
                      onChange={setReplyCC}
                      placeholder="Add CC recipients..."
                      className="text-sm flex-1"
                    />
                  </div>
                )}
                {showBCC && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-8 shrink-0">BCC:</span>
                    <EmailAutocomplete
                      autoFocus={!showCC}
                      value={replyBCC}
                      onChange={setReplyBCC}
                      placeholder="Add BCC recipients..."
                      className="text-sm flex-1"
                    />
                  </div>
                )}
              </div>
            )}

            {composeMode === 'forward' && (
              <EmailAutocomplete
                autoFocus
                value={forwardTo}
                onChange={setForwardTo}
                placeholder="email@example.com"
                className="text-sm"
              />
            )}

            <Textarea
              autoFocus={composeMode !== 'forward'}
              placeholder={composeMode === 'forward' ? 'Add a message (optional)...' : 'Write your reply...'}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={4}
              className="text-sm resize-none"
            />
            <AiWriteToolbar
              mailboxId={mailboxId}
              body={composeBody}
              subject={event.subject || ''}
              onApply={setComposeBody}
            />

            {(composeMode === 'reply' || composeMode === 'replyAll') && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="track-reply"
                  checked={trackReply}
                  onCheckedChange={(v) => setTrackReply(!!v)}
                />
                <label
                  htmlFor="track-reply"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
                >
                  <Eye className="h-3 w-3" />
                  Track email opens
                </label>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={
                  isSending ||
                  !composeBody.trim() ||
                  (composeMode === 'forward' && forwardTo.length === 0)
                }
                onClick={() => {
                  if (composeMode === 'reply') {
                    replyMutation.mutate();
                  } else if (composeMode === 'replyAll') {
                    replyAllMutation.mutate();
                  } else {
                    forwardMutation.mutate();
                  }
                }}
              >
                {isSending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3 w-3" />
                )}
                {isSending ? 'Sending...' : 'Send'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setComposeMode(null);
                  setComposeBody('');
                  setForwardTo([]);
                  setReplyCC([]);
                  setReplyBCC([]);
                  setShowCC(false);
                  setShowBCC(false);
                }}
                disabled={isSending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Email body */}
        <div className="border-t pt-3">
          {bodyLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messageBody ? (
            messageBody.contentType === 'html' ? (
              <HtmlEmailViewer html={messageBody.content} />
            ) : (
              <pre className="text-sm whitespace-pre-wrap break-words text-foreground">
                {messageBody.content}
              </pre>
            )
          ) : bodyError ? (
            <p className="text-sm text-muted-foreground italic">
              {bodyFetchError instanceof ApiError && bodyFetchError.status === 429
                ? 'Microsoft is rate limiting requests — wait a moment and click another email to retry.'
                : 'Email body unavailable — this message may have been moved or deleted.'}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Could not load email body
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
