/**
 * What a bulk apply (POST /api/patterns/bulk-approve) will do to one pattern,
 * decided from that pattern's current state alone.
 *
 *   'skip'      — approved and already doing exactly this; the live rule and its
 *                 execution stats are left alone
 *   'retarget'  — approved on a different action: the rule is deleted and rebuilt
 *   'unsilence' — rejected/expired: the cooldown is cleared and the sender is
 *                 taken back off the whitelist, or the new rule would never fire
 *   'approve'   — detected/suggested: a straight approval
 *
 * Lives apart from the route so it can be tested without loading BullMQ queues
 * and the Graph client.
 */
export type BulkPlan = 'skip' | 'retarget' | 'unsilence' | 'approve';

export function classifyBulkTarget(
  status: string,
  currentActionType: string,
  requestedActionType: string,
): BulkPlan {
  if (status === 'approved') {
    return currentActionType === requestedActionType ? 'skip' : 'retarget';
  }
  if (status === 'rejected' || status === 'expired') return 'unsilence';
  return 'approve';
}
