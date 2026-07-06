import { describe, it, expect, vi } from 'vitest';
import { Types } from 'mongoose';

// Mock everything the module imports at load time so this stays a pure-function
// unit test — no real Mongo/Redis/BullMQ connections.
vi.mock('../../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../config/redis.js', () => ({
  getRedisClient: vi.fn(),
}));
vi.mock('../../../models/EmailEvent.js', () => ({
  EmailEvent: { find: vi.fn() },
}));
vi.mock('../../../models/Mailbox.js', () => ({
  Mailbox: { find: vi.fn() },
}));
vi.mock('../../queues.js', () => ({
  queues: { 'email-embedding': { add: vi.fn() } },
}));

import { toEmbedJobData } from '../embeddingReconcile.js';

describe('toEmbedJobData', () => {
  const userId = new Types.ObjectId();
  const mailboxId = new Types.ObjectId();

  it('maps an EmailEvent + mailbox email to the embed-email job payload', () => {
    const event = {
      userId,
      mailboxId,
      messageId: 'msg-1',
      sender: { name: 'Alice', email: 'alice@example.com' },
      subject: 'Hello',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      toFolder: 'Inbox',
      importance: 'high',
      hasAttachments: true,
      categories: ['Work'],
      isRead: true,
      timestamp: new Date('2026-01-01T00:00:05.000Z'),
    } as any;

    const result = toEmbedJobData(event, 'mailbox@contoso.com');

    expect(result).toEqual({
      userId: String(userId),
      mailboxId: String(mailboxId),
      mailboxEmail: 'mailbox@contoso.com',
      messageId: 'msg-1',
      senderEmail: 'alice@example.com',
      senderName: 'Alice',
      subject: 'Hello',
      receivedAt: '2026-01-01T00:00:00.000Z',
      folder: 'Inbox',
      importance: 'high',
      hasAttachments: true,
      categories: ['Work'],
      isRead: true,
    });
  });

  it('falls back to timestamp and safe defaults when optional fields are missing', () => {
    const event = {
      userId,
      mailboxId,
      messageId: 'msg-2',
      sender: {},
      subject: undefined,
      receivedAt: undefined,
      toFolder: undefined,
      importance: undefined,
      hasAttachments: undefined,
      categories: undefined,
      isRead: undefined,
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    } as any;

    const result = toEmbedJobData(event, 'mailbox@contoso.com');

    expect(result.receivedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(result.senderEmail).toBe('');
    expect(result.senderName).toBe('');
    expect(result.subject).toBe('');
    expect(result.folder).toBe('');
    expect(result.importance).toBe('normal');
    expect(result.hasAttachments).toBe(false);
    expect(result.categories).toEqual([]);
    expect(result.isRead).toBe(false);
  });
});
