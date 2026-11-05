/**
 * Runtime validation boundary for Microsoft Graph webhook notifications.
 *
 * `POST /webhooks/graph` is the only route that accepts unauthenticated
 * external input by design, so every notification must be shape-checked before
 * its fields are used to build Mongo queries, BullMQ job ids or log lines.
 *
 * Hand-written type guard (rather than a schema library) because the backend
 * has no validation dependency and this audit fix must not add one.
 */

export interface GraphNotification {
  subscriptionId: string;
  changeType?: string;
  resource?: string;
  clientState?: string;
  lifecycleEvent?: string;
  resourceData?: {
    id?: string;
    '@odata.type'?: string;
  };
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * True when `x` is a plain object with a string `subscriptionId` and only
 * string-or-absent values in the other fields we read. Anything else (e.g.
 * `{ subscriptionId: { $ne: null } }`, which would otherwise reach Mongo as a
 * query operator) is rejected.
 */
export function isGraphNotification(x: unknown): x is GraphNotification {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;

  const n = x as Record<string, unknown>;

  if (typeof n.subscriptionId !== 'string' || n.subscriptionId.length === 0) return false;
  if (!isOptionalString(n.changeType)) return false;
  if (!isOptionalString(n.resource)) return false;
  if (!isOptionalString(n.clientState)) return false;
  if (!isOptionalString(n.lifecycleEvent)) return false;

  if (n.resourceData !== undefined && n.resourceData !== null) {
    if (typeof n.resourceData !== 'object' || Array.isArray(n.resourceData)) return false;
    if (!isOptionalString((n.resourceData as Record<string, unknown>).id)) return false;
  }

  return true;
}
