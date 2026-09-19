import { graphFetch, GraphApiError } from '../graphClient.js';
import { type GraphMessage } from '../metadataExtractor.js';
import { buildSelectParam } from '../../utils/graph.js';
import logger from '../../config/logger.js';

/**
 * Fetch a message from Graph API using $select to minimize payload.
 * Returns null if the message was deleted (404) between notification and fetch.
 */
export async function fetchGraphMessage(
  mailboxEmail: string,
  messageId: string,
  accessToken: string,
): Promise<GraphMessage | null> {
  const selectParam = buildSelectParam('message');
  const path = `/users/${mailboxEmail}/messages/${messageId}?$select=${selectParam}`;

  try {
    const response = await graphFetch(path, accessToken);
    return (await response.json()) as GraphMessage;
  } catch (err) {
    if (err instanceof GraphApiError && err.status === 404) {
      logger.info('Message deleted between notification and fetch -- skipping', {
        mailboxEmail,
        messageId,
      });
      return null;
    }
    throw err;
  }
}
