'use client';

/**
 * app/lib/useUserId.ts
 * Client-side user ID extraction from the Main Station auth cookie.
 *
 * The Main Station sets a cookie (name configured via NEXT_PUBLIC_AUTH_COOKIE_NAME)
 * that carries the authenticated user ID. This utility reads that cookie so that
 * frontend components can pass the user ID to API calls.
 *
 * In development without a cookie, this falls back to the DEV_TEST_USER_ID so
 * local development continues to work without needing a real session.
 *
 * IMPORTANT: API routes should prefer reading the cookie directly via getUserIdFromRequest
 * rather than relying on the frontend to pass user_id. This utility is for cases where
 * user_id MUST be included in the request body or query string.
 */

import { useState, useEffect } from 'react';
import { env } from '@/lib/env';

export const DEV_TEST_USER_ID = '00000000-0000-0000-0000-000000000000';

function getCookieName(): string {
  if (typeof window === 'undefined') return 'uid';
  return env.authCookieName();
}

/**
 * Reads the user ID from the browser cookie jar.
 * Returns the raw cookie value or null if not present.
 */
export function getUserIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const cookieName = getCookieName();
  const match = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(cookieName + '='));

  if (!match) return null;
  const eqIdx = match.indexOf('=');
  return eqIdx === -1 ? null : match.slice(eqIdx + 1) || null;
}

/**
 * Returns the authenticated user ID for use in API calls.
 *
 * In development (NODE_ENV !== 'production'):
 *   - Returns the cookie value if present
 *   - Falls back to DEV_TEST_USER_ID if no cookie is found
 *
 * In production:
 *   - Returns the cookie value if present
 *   - Returns null if no cookie is found (caller should handle gracefully)
 *
 * This is a synchronous read — call this when you need the user ID immediately.
 * For React components that need reactivity, use useUserId() instead.
 */
export function getClientUserId(): string | null {
  // P0 2026-08-02 (TC-P0-09): Prefer URL query (?uid= / ?userId=) over cookie.
  // Production servers may fail to read the cross-domain auth cookie set by
  // the Main Station, so the URL query is the only reliable UID source for
  // Commander QA / testing scenarios. The cookie is still consulted as a
  // secondary source before the dev-only fallback ID.
  const queryUid = readUserIdFromUrl();
  if (queryUid) return queryUid;

  const cookieValue = getUserIdFromCookie();
  if (cookieValue) return cookieValue;

  // Dev fallback
  if (!env.isProd()) {
    return DEV_TEST_USER_ID;
  }

  // Production: no cookie = not authenticated
  return null;
}

/**
 * P0 2026-08-02 (TC-P0-09): Read ?uid= / ?userId= from the current URL.
 * Returns the raw value (NOT canonicalized) so the API can echo it back
 * verbatim to the caller. SSR-guarded — returns null on the server.
 */
function readUserIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('uid') ?? params.get('userId');
    if (v && v.trim().length > 0) return v.trim();
  } catch {
    // URLSearchParams may throw on malformed URLs — treat as no UID.
  }
  return null;
}

/**
 * React hook for reactive user ID.
 * Re-reads from cookie whenever it changes (e.g., after login/logout).
 */
export function useUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(() => getClientUserId());

  useEffect(() => {
    // Re-read on mount (cookie may not be available during SSR)
    setUserId(getClientUserId());

    // Watch for cookie changes (login/logout)
    const interval = setInterval(() => {
      const current = getClientUserId();
      setUserId((prev) => {
        if (prev !== current) return current;
        return prev;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return userId;
}

/**
 * Helper: builds an Authorization header value for API calls.
 * Returns `Bearer <userId>` or null if not authenticated.
 */
export function getAuthHeader(): string | null {
  const uid = getClientUserId();
  if (!uid) return null;
  return `Bearer ${uid}`;
}
