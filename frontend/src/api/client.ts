/**
 * API client with cookie-based authentication.
 *
 * Uses credentials: 'include' to send the httpOnly session cookie.
 * Automatically redirects to /login on 401 responses.
 *
 * Path handling:
 * - Paths starting with /auth are used as-is (e.g., /auth/me -> /auth/me)
 * - All other paths are prefixed with /api (e.g., /dashboard/stats -> /api/dashboard/stats)
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: unknown,
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

function buildUrl(path: string): string {
  if (path.startsWith('/auth')) {
    return path;
  }
  return `/api${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = buildUrl(path);

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (response.status === 401) {
    // Session expired or not authenticated -- redirect to login
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Response body not JSON
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  // Handle empty responses (e.g., 204 No Content)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
