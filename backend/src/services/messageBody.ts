// Shared inline-CID-image substitution logic used by both the live message
// route (backend/src/routes/mailbox/messages.ts) and the body-prefetch
// background job (backend/src/jobs/processors/bodyPrefetch.ts).

export interface CidAttachment {
  contentId?: string;
  contentType?: string;
  contentBytes?: string;
  isInline?: boolean;
}

/**
 * If the given body is HTML and contains `cid:` references, rewrite those
 * references in-place to `data:` URIs built from the matching inline
 * attachments (by contentId). Mutates `body.content` when a substitution is
 * made; leaves the body unchanged otherwise. Never throws — attachment
 * matching is best-effort and any failure should not block returning/caching
 * the message body.
 */
export function inlineCidImages(
  body: { contentType?: string; content?: string } | undefined,
  attachments: CidAttachment[] | undefined,
): void {
  if (!body || body.contentType !== 'html' || !body.content?.includes('cid:')) {
    return;
  }

  if (!attachments?.length) {
    return;
  }

  let html = body.content;
  for (const att of attachments) {
    if (att.contentId && att.contentBytes && att.contentType?.startsWith('image/')) {
      const cid = att.contentId.replace(/^<|>$/g, '');
      const dataUri = `data:${att.contentType};base64,${att.contentBytes}`;
      html = html.split(`cid:${cid}`).join(dataUri);
      html = html.split(`cid:<${cid}>`).join(dataUri);
    }
  }
  body.content = html;
}
