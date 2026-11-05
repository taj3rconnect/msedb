/**
 * Query shaping for the inbox "Read" / "Deleted" rule-action filters.
 *
 * Extracted from routes/events.ts so the one genuinely subtle rule here -- the
 * date window moves from arrival time to ACTION time -- can be tested without
 * standing up the whole route.
 */

/** Maps the public ?ruleAction= value to the provenance field it filters on. */
export const RULE_ACTION_FIELDS: Record<string, string> = {
  read: 'metadata.ruleMarkedReadAt',
  deleted: 'metadata.ruleDeletedAt',
};

/** The provenance field for a ruleAction value, or undefined if unrecognised. */
export function resolveRuleActionField(ruleAction: unknown): string | undefined {
  return typeof ruleAction === 'string' ? RULE_ACTION_FIELDS[ruleAction] : undefined;
}

/**
 * Narrow `filter` to events a RULE acted on, MOVING any date window from
 * `timestamp` onto the action timestamp.
 *
 * Why the move matters: `timestamp` is when the email ARRIVED. An email that
 * landed last week and was deleted by a rule this morning belongs in "Deleted
 * / Today" -- filtering it by arrival would drop it, which is precisely the
 * question this filter exists to answer.
 *
 * Mutates and returns `filter`. A no-op for an unrecognised ruleAction, so an
 * unknown value degrades to the normal unfiltered listing rather than throwing.
 */
export function applyRuleActionFilter(
  filter: Record<string, unknown>,
  ruleAction: unknown,
): Record<string, unknown> {
  const field = resolveRuleActionField(ruleAction);
  if (!field) return filter;

  const window = (filter.timestamp as Record<string, unknown>) || {};
  delete filter.timestamp;
  filter[field] = { $exists: true, $ne: null, ...window };
  return filter;
}
