/**
 * Graph API $select field definitions.
 *
 * ALL Graph API calls MUST use $select to minimize payload size and comply with INFR-04.
 * This ensures we only fetch the fields we actually need, reducing bandwidth and
 * improving response times. Import SELECT_FIELDS or use buildSelectParam() for
 * every Graph API request.
 */
export const SELECT_FIELDS = {
  message: [
    'id',
    'subject',
    'from',
    'toRecipients',
    'receivedDateTime',
    'isRead',
    'importance',
    'hasAttachments',
    'conversationId',
    'categories',
    'flag',
    'internetMessageId',
    'parentFolderId',
    'internetMessageHeaders',
  ],
  mailFolder: [
    'id',
    'displayName',
    'parentFolderId',
    'totalItemCount',
    'unreadItemCount',
  ],
  messageRule: [
    'id',
    'displayName',
    'sequence',
    'isEnabled',
    'conditions',
    'actions',
  ],
  subscription: [
    'id',
    'resource',
    'changeType',
    'expirationDateTime',
    'notificationUrl',
  ],
} as const;

export type GraphResourceType = keyof typeof SELECT_FIELDS;

/**
 * Build a comma-joined $select query parameter string for a given Graph API resource type.
 * @param resourceType - The Graph API resource type (message, mailFolder, messageRule, subscription)
 * @returns A comma-separated string of field names suitable for the $select query parameter
 */
export function buildSelectParam(resourceType: GraphResourceType): string {
  return SELECT_FIELDS[resourceType].join(',');
}
