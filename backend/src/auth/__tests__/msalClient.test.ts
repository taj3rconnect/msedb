import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_KEY = '0ef4530ecd7c7b8fb5fc90d29aa68f542e238d2ce928389d3f79426ec460ea43';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/index.js', () => ({
  config: {
    encryptionKey: TEST_KEY,
    azureAdClientId: 'client-id',
    azureAdTenantId: 'tenant-id',
    azureAdClientSecret: 'secret',
  },
}));

const mockSelect = vi.fn();
const mockFindById = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));
const mockFindByIdAndUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../models/Mailbox.js', () => ({
  Mailbox: {
    findById: (...args: unknown[]) => mockFindById(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

const { MongoDBCachePlugin } = await import('../msalClient.js');
const logger = (await import('../../config/logger.js')).default;

function makeCacheContext(serializedValue: string, cacheHasChanged: boolean) {
  return {
    cacheHasChanged,
    tokenCache: {
      deserialize: vi.fn(),
      serialize: vi.fn().mockReturnValue(serializedValue),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MongoDBCachePlugin', () => {
  it('encrypts the serialized cache on write and decrypts it back on read (roundtrip)', async () => {
    const plugin = new MongoDBCachePlugin('mailbox-1');
    const plaintextCache = JSON.stringify({ Account: { foo: 'bar' } });

    // Write path: afterCacheAccess should persist an EncryptedData blob, not plaintext.
    const writeContext = makeCacheContext(plaintextCache, true);
    await plugin.afterCacheAccess(writeContext);

    expect(mockFindByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockFindByIdAndUpdate.mock.calls[0];
    const stored = update.msalCache;
    expect(stored).toHaveProperty('encrypted');
    expect(stored).toHaveProperty('iv');
    expect(stored).toHaveProperty('tag');
    expect(stored.encrypted).not.toBe(plaintextCache);

    // Read path: beforeCacheAccess should decrypt the stored blob back to the original plaintext.
    mockSelect.mockResolvedValue({ msalCache: stored });
    const readContext = makeCacheContext('', false);
    await plugin.beforeCacheAccess(readContext);

    expect(readContext.tokenCache.deserialize).toHaveBeenCalledWith(plaintextCache);
  });

  it('deserializes legacy plaintext caches without throwing (lazy migration)', async () => {
    const plugin = new MongoDBCachePlugin('mailbox-2');
    const legacyPlaintext = JSON.stringify({ Account: { legacy: true } });
    mockSelect.mockResolvedValue({ msalCache: legacyPlaintext });

    const readContext = makeCacheContext('', false);
    await plugin.beforeCacheAccess(readContext);

    expect(readContext.tokenCache.deserialize).toHaveBeenCalledWith(legacyPlaintext);
  });

  it('logs an error and does not throw when the encrypted cache cannot be decrypted', async () => {
    const plugin = new MongoDBCachePlugin('mailbox-3');
    mockSelect.mockResolvedValue({
      msalCache: { encrypted: 'deadbeef', iv: '00'.repeat(12), tag: '00'.repeat(16) },
    });

    const readContext = makeCacheContext('', false);
    await expect(plugin.beforeCacheAccess(readContext)).resolves.not.toThrow();

    expect(readContext.tokenCache.deserialize).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('re-authentication'),
      expect.objectContaining({ mailboxId: 'mailbox-3' })
    );
  });

  it('does nothing when no cache is stored for the mailbox', async () => {
    const plugin = new MongoDBCachePlugin('mailbox-4');
    mockSelect.mockResolvedValue(null);

    const readContext = makeCacheContext('', false);
    await plugin.beforeCacheAccess(readContext);

    expect(readContext.tokenCache.deserialize).not.toHaveBeenCalled();
  });
});
