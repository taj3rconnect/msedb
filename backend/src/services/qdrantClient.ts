import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import crypto from 'crypto';

let client: QdrantClient | null = null;

const VECTOR_SIZE = 768; // nomic-embed-text dimension

export interface EmailVectorPoint {
  id: string; // deterministic UUID
  vector: number[];
  payload: EmailVectorPayload;
}

export interface EmailVectorPayload {
  userId: string;
  mailboxId: string;
  messageId: string;
  senderEmail: string;
  senderName: string;
  senderDomain: string;
  subject: string;
  bodySnippet: string; // first 500 chars of plain text
  receivedAt: string; // ISO date
  folder: string;
  importance: string;
  hasAttachments: boolean;
  categories: string[];
  isRead: boolean;
  embeddedAt: string; // ISO date
}

/**
 * Get or create a Qdrant client singleton.
 */
export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: config.qdrantUrl });
  }
  return client;
}

/**
 * Generate a deterministic UUID v5-style ID from userId:mailboxId:messageId.
 * Uses a consistent namespace to ensure idempotent upserts.
 */
export function makePointId(userId: string, mailboxId: string, messageId: string): string {
  const input = `${userId}:${mailboxId}:${messageId}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Ensure the Qdrant collection exists with proper schema and indexes.
 * Idempotent — safe to call on every startup.
 */
export async function ensureQdrantCollection(): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = config.qdrantCollection;

  try {
    const exists = await qdrant.collectionExists(collectionName);
    if (exists.exists) {
      logger.info('Qdrant collection already exists', { collection: collectionName });
      return;
    }

    await qdrant.createCollection(collectionName, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });

    // Create payload indexes for filtered search
    const indexFields = ['userId', 'mailboxId', 'senderEmail', 'senderDomain', 'receivedAt'];
    for (const field of indexFields) {
      await qdrant.createPayloadIndex(collectionName, {
        field_name: field,
        field_schema: field === 'receivedAt' ? 'datetime' : 'keyword',
      });
    }

    // Boolean index for hasAttachments
    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'hasAttachments',
      field_schema: 'bool',
    });

    // Keyword index for importance
    await qdrant.createPayloadIndex(collectionName, {
      field_name: 'importance',
      field_schema: 'keyword',
    });

    logger.info('Qdrant collection created with indexes', { collection: collectionName });
  } catch (err) {
    logger.error('Failed to ensure Qdrant collection', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Upsert a single email vector point.
 */
export async function upsertEmailVector(point: EmailVectorPoint): Promise<void> {
  const qdrant = getQdrantClient();
  await qdrant.upsert(config.qdrantCollection, {
    wait: true,
    points: [
      {
        id: point.id,
        vector: point.vector,
        payload: point.payload as unknown as Record<string, unknown>,
      },
    ],
  });
}

/**
 * Upsert a batch of email vector points.
 */
export async function upsertEmailVectorsBatch(points: EmailVectorPoint[]): Promise<void> {
  if (points.length === 0) return;
  const qdrant = getQdrantClient();
  await qdrant.upsert(config.qdrantCollection, {
    wait: true,
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload as unknown as Record<string, unknown>,
    })),
  });
}

/**
 * Delete email vectors by their point IDs.
 */
export async function deleteEmailVectors(pointIds: string[]): Promise<void> {
  if (pointIds.length === 0) return;
  const qdrant = getQdrantClient();
  await qdrant.delete(config.qdrantCollection, {
    wait: true,
    points: pointIds,
  });
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: EmailVectorPayload;
}

/**
 * Search for similar email vectors with optional payload filters.
 */
export async function searchEmailVectors(
  vector: number[],
  filter: Record<string, unknown> | undefined,
  limit: number = 20,
): Promise<VectorSearchResult[]> {
  const qdrant = getQdrantClient();
  const results = await qdrant.query(config.qdrantCollection, {
    query: vector,
    filter: filter as never,
    limit,
    with_payload: true,
  });

  return (results.points ?? []).map((p) => ({
    id: String(p.id),
    score: p.score ?? 0,
    payload: p.payload as unknown as EmailVectorPayload,
  }));
}

/**
 * Get collection info (point count, etc.) for health checks.
 */
export async function getCollectionInfo(): Promise<{ pointCount: number } | null> {
  try {
    const qdrant = getQdrantClient();
    const info = await qdrant.getCollection(config.qdrantCollection);
    return { pointCount: info.points_count ?? 0 };
  } catch {
    return null;
  }
}
