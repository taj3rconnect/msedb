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
 * Thin wrapper around native fetch() for Microsoft Graph API v1.0 calls.
 *
 * - Injects Bearer token via Authorization header
 * - Supports absolute URLs (e.g., nextLink/deltaLink) and relative paths (prepends GRAPH_BASE)
 * - Throws GraphApiError on non-ok responses
 * - No retry logic here -- BullMQ handles retries at the job level
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

  const response = await fetch(url, {
    ...options,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GraphApiError(response.status, body, path);
  }

  return response;
}
