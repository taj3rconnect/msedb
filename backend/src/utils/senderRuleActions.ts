/**
 * Sender → rule-action mapping for the inbox row-actions icon.
 *
 * The inbox "Remove all rules for this sender" button turns orange when the
 * sender already has rules. The set it reports MUST be the same set that
 * `POST /api/rules/delete-by-sender` would delete — i.e. matched on
 * `conditions.senderEmail` (case-insensitive), never on domain — otherwise the
 * icon lies about what clicking it removes.
 */

/** Minimal rule shape this module needs — keeps it decoupled from the model. */
export interface SenderRuleLike {
  conditions?: { senderEmail?: string | string[] | null } | null;
  actions?: Array<{ actionType?: string | null }> | null;
}

/** Minimal event shape this module needs. */
export interface SenderEventLike {
  sender?: { email?: string | null } | null;
}

/**
 * Collect the distinct, lowercased sender emails present on a page of events.
 * Used to build a bounded `$in` list — never fetch every rule for the user.
 */
export function collectSenderEmails(events: SenderEventLike[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    const email = e.sender?.email;
    if (typeof email === 'string' && email.trim()) set.add(email.trim().toLowerCase());
  }
  return [...set];
}

/**
 * Build `lowercased sender email → distinct action types` from the rules found.
 *
 * Action order is preserved as first-seen so the UI badge is stable between
 * renders rather than reshuffling on every fetch.
 */
export function buildSenderActionMap(rules: SenderRuleLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const rule of rules) {
    const cond = rule.conditions?.senderEmail;
    if (!cond) continue;
    const emails = Array.isArray(cond) ? cond : [cond];

    const actionTypes = (rule.actions ?? [])
      .map((a) => a?.actionType)
      .filter((a): a is string => typeof a === 'string' && a.length > 0);
    if (actionTypes.length === 0) continue;

    for (const raw of emails) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const key = raw.trim().toLowerCase();
      const existing = map.get(key) ?? [];
      for (const at of actionTypes) {
        if (!existing.includes(at)) existing.push(at);
      }
      map.set(key, existing);
    }
  }

  return map;
}

/**
 * Attach `senderRuleActions` to each event. Always an array (never undefined)
 * so the frontend can branch on length without a null check.
 */
export function attachSenderRuleActions<T extends SenderEventLike>(
  events: T[],
  actionMap: Map<string, string[]>,
): Array<T & { senderRuleActions: string[] }> {
  return events.map((e) => {
    const email = e.sender?.email;
    const key = typeof email === 'string' ? email.trim().toLowerCase() : '';
    return { ...e, senderRuleActions: key ? actionMap.get(key) ?? [] : [] };
  });
}
