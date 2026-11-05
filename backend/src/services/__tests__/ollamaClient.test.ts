import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/index.js', () => ({
  config: {
    ollamaUrl: 'http://ollama.test:11434',
    ollamaEmbedModel: 'nomic-embed-text',
    ollamaInstructModel: 'qwen3:1.7b',
    ollamaWriteModel: 'qwen3.5:35b-a3b',
  },
}));

const { generateEmbedding } = await import('../ollamaClient.js');

const realTimeout = AbortSignal.timeout.bind(AbortSignal);
let requestedTimeouts: number[] = [];

beforeEach(() => {
  requestedTimeouts = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  AbortSignal.timeout = realTimeout;
});

describe('generateEmbedding', () => {
  it('rejects instead of hanging forever when Ollama never responds', async () => {
    // Record the real requested timeout, but fire it quickly so the test is
    // bounded. The abort path exercised is the production one.
    AbortSignal.timeout = ((ms: number) => {
      requestedTimeouts.push(ms);
      return realTimeout(50);
    }) as typeof AbortSignal.timeout;

    // A fetch that NEVER resolves on its own — it only settles when aborted,
    // which is exactly how a hung Ollama behaves.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        return new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason));
        });
      }),
    );

    const result = await Promise.race([
      generateEmbedding('hello world').then(
        () => 'resolved',
        (err: unknown) => err,
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 2000)),
    ]);

    expect(result).not.toBe('hung');
    expect(result).not.toBe('resolved');
    expect((result as Error).name).toBe('TimeoutError');
    // Production timeout must be the 30s Graph convention, not the test's 50ms.
    expect(requestedTimeouts).toEqual([30_000]);
  });
});
