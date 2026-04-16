/**
 * API client with cookie-based authentication and CSRF protection.
 *
 * Uses credentials: 'include' to send the httpOnly session cookie.
 * Automatically redirects to /login on 401 responses.
 * Attaches X-CSRF-Token header to all state-changing requests.
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

// CSRF token cache — fetched once per session, refreshed on 403
let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string> | null = null;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/auth/csrf-token', { credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to fetch CSRF token');
  }
  const data = (await res.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

/**
 * Get a CSRF token, fetching one if not cached.
 * Deduplicates concurrent fetches.
 */
export async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => {
      csrfFetchPromise = null;
    });
  }
  return csrfFetchPromise;
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
  const method = options?.method?.toUpperCase() ?? 'GET';

  // Attach CSRF token to state-changing requests
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (!SAFE_METHODS.has(method)) {
    headers['X-CSRF-Token'] = await getCsrfToken();
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  // CSRF token expired or rotated — refresh and retry once
  if (response.status === 403 && !SAFE_METHODS.has(method)) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (body?.error?.message === 'CSRF token mismatch') {
      csrfToken = null;
      headers['X-CSRF-Token'] = await getCsrfToken();
      const retry = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
      });
      if (retry.ok || retry.status === 204) {
        if (retry.status === 204 || retry.headers.get('content-length') === '0') {
          return undefined as T;
        }
        return retry.json() as Promise<T>;
      }
      throw new ApiError(retry.status, retry.statusText);
    }
  }

  if (response.status === 401) {
    // Session expired or not authenticated -- redirect to login
    // Skip redirect if already on login page to avoid reload loop
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
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
