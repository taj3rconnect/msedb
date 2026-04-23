export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Graph-specific error for failed API calls.
 * Carries the HTTP status, response body, and request path for debugging.
 * This is NOT an AppError -- it is used internally by services, not for HTTP responses.
 */
export class GraphApiError extends Error {
  public status: number;
  public body: string;
  public path: string;

  constructor(status: number, body: string, path: string) {
    super(`Graph API error ${status} on ${path}: ${body.substring(0, 200)}`);
    this.name = 'GraphApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

/**
 * Semaphore limiting the number of concurrent outbound Graph API calls.
 *
 * Graph enforces a MailboxConcurrency limit (~4 parallel connections per
 * mailbox per app). We cap at 3 so background workers don't starve
 * user-triggered interactive requests.
 */
class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.slots = max;
  }

  acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }
}

const graphConcurrency = new Semaphore(2);

/**
 * Thin wrapper around native fetch() for Microsoft Graph API v1.0 calls.
 *
 * - Injects Bearer token via Authorization header
 * - Supports absolute URLs (e.g., nextLink/deltaLink) and relative paths (prepends GRAPH_BASE)
 * - Enforces a process-wide concurrency limit of 3 to avoid MailboxConcurrency 429s
 * - On 429 (rate limit): reads Retry-After header, waits, then retries once
 * - Throws GraphApiError on non-ok responses
 *
 * @param path - Relative path (e.g., "/subscriptions") or absolute URL
 * @param accessToken - OAuth2 Bearer token
 * @param options - Additional fetch options (method, body, headers, etc.)
 * @returns The raw Response object on success
 */
export async function graphFetch(
  path: string,
  accessToken: string,
  options?: RequestInit,
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;

  const mergedHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    return fetch(url, {
      ...options,
      headers: mergedHeaders,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  };

  // First attempt
  await graphConcurrency.acquire();
  let response: Response;
  try {
    response = await doFetch();
  } finally {
    graphConcurrency.release();
  }

  // 429: release the slot, wait, then retry once with a fresh slot.
  // Releasing before waiting lets other callers (including user-triggered requests)
  // proceed while this background call is backing off.
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '10', 10);
    const waitMs = Math.min(isNaN(retryAfter) ? 10 : retryAfter, 30) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    await graphConcurrency.acquire();
    try {
      response = await doFetch();
    } finally {
      graphConcurrency.release();
    }
  }

  if (!response.ok) {
    const body = await response.text();
    throw new GraphApiError(response.status, body, path);
  }

  return response;
}
