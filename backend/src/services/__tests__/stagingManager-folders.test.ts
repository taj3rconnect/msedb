import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockGraphFetch, mockIndexes, mockDropIndex } = vi.hoisted(() => ({
  mockGraphFetch: vi.fn(),
  mockIndexes: vi.fn(),
  mockDropIndex: vi.fn(),
}));

vi.mock('../graphClient.js', () => ({ graphFetch: mockGraphFetch }));
vi.mock('../../models/StagedEmail.js', () => ({
  StagedEmail: { collection: { indexes: mockIndexes, dropIndex: mockDropIndex } },
}));
vi.mock('../../models/AuditLog.js', () => ({ AuditLog: {} }));
vi.mock('../../utils/ruleActionStamp.js', () => ({ clearRuleDeletedStamp: vi.fn() }));
vi.mock('../../config/socket.js', () => ({ getIO: vi.fn() }));

const { dropStaleStagingTtlIndex, isRuleExemptFolder } = await import('../stagingManager.js');

const json = (body: unknown) => ({ json: () => Promise.resolve(body) });

function stubFolders() {
  mockGraphFetch.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/mailFolders/deleteditems')
        ? json({ id: 'deleted-id' })
        : json({ value: [{ id: 'staging-id', displayName: 'MSEDB Staging' }] }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubFolders();
});

describe('isRuleExemptFolder', () => {
  it('exempts Deleted Items', async () => {
    await expect(isRuleExemptFolder('a@example.com', 'deleted-id', 't')).resolves.toBe(true);
  });

  it('exempts MSEDB Staging', async () => {
    await expect(isRuleExemptFolder('b@example.com', 'staging-id', 't')).resolves.toBe(true);
  });

  it('does not exempt any other folder', async () => {
    await expect(isRuleExemptFolder('c@example.com', 'inbox-id', 't')).resolves.toBe(false);
  });

  it('does not exempt a message with no folder, and asks Graph nothing', async () => {
    await expect(isRuleExemptFolder('d@example.com', undefined, 't')).resolves.toBe(false);
    expect(mockGraphFetch).not.toHaveBeenCalled();
  });

  it('looks each folder up only once per mailbox', async () => {
    await isRuleExemptFolder('e@example.com', 'inbox-id', 't');
    await isRuleExemptFolder('e@example.com', 'inbox-id', 't');

    expect(mockGraphFetch).toHaveBeenCalledTimes(2);
  });
});

describe('dropStaleStagingTtlIndex', () => {
  const ID_INDEX = { key: { _id: 1 }, name: '_id_' };
  const COMPOUND = { key: { userId: 1, status: 1, expiresAt: 1 }, name: 'compound' };
  const CLEANUP_TTL = { key: { cleanupAt: 1 }, name: 'cleanupAt_1', expireAfterSeconds: 0 };
  const STALE_TTL = { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 };

  it('drops the stale TTL index', async () => {
    mockIndexes.mockResolvedValue([ID_INDEX, COMPOUND, STALE_TTL, CLEANUP_TTL]);

    await expect(dropStaleStagingTtlIndex()).resolves.toBe(true);

    expect(mockDropIndex).toHaveBeenCalledTimes(1);
    expect(mockDropIndex).toHaveBeenCalledWith('expiresAt_1');
  });

  it('leaves the cleanupAt TTL and the compound index alone', async () => {
    mockIndexes.mockResolvedValue([ID_INDEX, COMPOUND, CLEANUP_TTL]);

    await expect(dropStaleStagingTtlIndex()).resolves.toBe(false);

    expect(mockDropIndex).not.toHaveBeenCalled();
  });

  it('leaves a plain, non-TTL expiresAt index alone', async () => {
    mockIndexes.mockResolvedValue([{ key: { expiresAt: 1 }, name: 'expiresAt_1' }]);

    await expect(dropStaleStagingTtlIndex()).resolves.toBe(false);

    expect(mockDropIndex).not.toHaveBeenCalled();
  });

  it('does nothing on a fresh database', async () => {
    mockIndexes.mockRejectedValue(Object.assign(new Error('ns not found'), { code: 26 }));

    await expect(dropStaleStagingTtlIndex()).resolves.toBe(false);
  });

  it('fails loudly on any other database error', async () => {
    mockIndexes.mockRejectedValue(new Error('mongo connection lost'));

    await expect(dropStaleStagingTtlIndex()).rejects.toThrow('mongo connection lost');
  });
});
