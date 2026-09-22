/**
 * Admin API Utilities
 * Provides authenticated headers for admin API calls.
 *
 * SECURITY: Admin authentication is handled server-side via the /api/admin/validate endpoint.
 * The client-side only stores a session marker (not the actual secret).
 */
import { fetchWithTimeout, FetchError, humanizeFetchError } from '@/app/lib/fetchWithTimeout';

const ADMIN_SESSION_KEY = 'admin_session';

export function getAdminSession(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ADMIN_SESSION_KEY);
}

export function setAdminSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ADMIN_SESSION_KEY, 'authenticated');
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function getAdminHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch wrapper for admin API calls.
 *
 * V6 — delegates to fetchWithTimeout so every admin call gets:
 *   • AbortController cleanup on unmount
 *   • 8s default timeout (4× production P99)
 *   • typed FetchError discrimination
 *
 * Back-compat shim: every existing consumer calls
 *   const res = await adminFetch(...)
 *   if (res.ok) { const data = await res.json(); ... }
 * We return a Response-shaped wrapper so the .ok / .json() / .blob() chain
 * keeps compiling without callers having to migrate to the typed shape
 * (that's a stage-7 debt-reduction exercise).
 *
 * The typed discriminated-result lives next to `.value` for new code.
 */
type AdminFetchResult = Response & {
  value: { ok: boolean; status: number; data: unknown; error: FetchError | null };
};

export async function adminFetch(
  url: string,
  options: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AdminFetchResult> {
  const { timeoutMs, signal, headers, ...rest } = options;

  const handleResult = async (): Promise<AdminFetchResult> => {
    const result = await fetchWithTimeout(url, {
      ...rest,
      credentials: 'include',
      headers: {
        ...getAdminHeaders(),
        ...headers,
      },
      signal,
      timeoutMs,
      rawResponse: true,
    });
    const fakeResponse = result.raw as unknown as Response;
    const patched = Object.assign(fakeResponse, {
      value: { ok: true, status: result.status, data: result.data, error: null },
    });
    return patched as AdminFetchResult;
  };

  try {
    return await handleResult();
  } catch (e) {
    // REPARK 7.0 (2026-09-17 round 4): preserve the route's structured
    // error body (ALREADY_CLAIMED, INTERNAL_ERROR, etc.) when available.
    // Only fall back to humanizeFetchError when the body was absent or non-JSON.
    const err = e instanceof FetchError
      ? e
      : new FetchError({
          kind: 'NETWORK',
          retryable: true,
          reqId: 'na',
          url,
          method: (options.method ?? 'GET').toString(),
          elapsedMs: 0,
          cause: e instanceof Error ? e.message : String(e),
        });
    // Valid HTTP status range; fallback to 500/599 for non-HTTP errors.
    const safeStatus =
      err.payload.kind === 'HTTP_NON_2XX' &&
      err.payload.status != null &&
      err.payload.status >= 200 &&
      err.payload.status < 600
        ? err.payload.status
        : err.payload.kind === 'HTTP_NON_2XX' ? 500 : 599;
    // Prefer the parsed JSON body; fall back to humanized generic message.
    const preserved =
      err.payload.kind === 'HTTP_NON_2XX' &&
      err.payload.parsed != null &&
      typeof err.payload.parsed === 'object'
        ? err.payload.parsed
        : {
            ok: false,
            error: {
              code: err.payload.kind,
              message: humanizeFetchError(err),
              reqId: err.payload.reqId,
              elapsedMs: err.payload.elapsedMs,
            },
          };
    const body = JSON.stringify(preserved);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const fake = new Response(body, { status: safeStatus, statusText: err.payload.kind ?? '', headers });
    const patched = Object.assign(fake, {
      value: { ok: false, status: safeStatus, data: null, error: err },
    });
    return patched as AdminFetchResult;
  }
}

export { humanizeFetchError };


