import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminToken, isAdminDevBypass } from '@/app/lib/adminToken';
import { isOriginAllowed } from '@/lib/csrf';

const ADMIN_COOKIE = 'admin_token';

/**
 * Reads the auth cookie name from env. Default: "uid".
 * In production, NEXT_PUBLIC_AUTH_COOKIE_NAME must be set by the Main Station
 * integration team so the correct cookie is checked.
 */
function getAuthCookieName(): string {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME ?? 'uid';
}

/**
 * URL of the Main Station login page. Configure via NEXT_PUBLIC_MAIN_STATION_URL.
 */
function getLoginUrl(request: NextRequest): string {
  const base =
    process.env.NEXT_PUBLIC_MAIN_STATION_URL ??
    'https://main-station.example.com/login';
  // Preserve the original URL so Main Station can redirect back after login
  const redirect = `?redirect=${encodeURIComponent(request.url)}`;
  return `${base.replace(/\?.*$/, '')}${redirect}`;
}

/**
 * Iron Gate — admin API guard.
 *
 * Verifies the `admin_token` HMAC cookie against `ADMIN_SECRET_KEY`
 * BEFORE any admin API handler is invoked. This is the SINGLE source
 * of truth for admin API authentication. Individual route handlers
 * retain their `requireAdminAuth()` calls as belt-and-suspenders, but
 * no request ever reaches them without a valid token.
 *
 * Returns:
 *   - null                  → token is valid; continue to the route
 *   - 401 NextResponse      → token missing/invalid/expired
 */
function checkAdminApiToken(request: NextRequest): Promise<NextResponse | null> {
  const adminSecret = process.env.ADMIN_SECRET_KEY;
  const isProd = process.env.NODE_ENV === 'production';
  const devBypass = isAdminDevBypass();

  // Production hard-fail: secret must be configured.
  if (isProd && !adminSecret) {
    console.error(
      '[IRON_GATE] FATAL: ADMIN_SECRET_KEY is not set in production. ' +
        'Rejecting all admin API requests.'
    );
    return Promise.resolve(
      NextResponse.json(
        { ok: false, error: { code: 'MISCONFIGURED', message: 'Server misconfigured' } },
        { status: 500 }
      )
    );
  }

  // Non-production: reject unless either a secret OR a dev-bypass opt-in is set.
  if (!isProd && !adminSecret && !devBypass) {
    return Promise.resolve(
      NextResponse.json(
        {
          ok: false,
          error: {
            code: 'MISCONFIGURED',
            message:
              'ADMIN_SECRET_KEY is required. Set it in .env.local, ' +
              'or run with ADMIN_DEV_BYPASS=1 to enable dev login.',
          },
        },
        { status: 500 }
      )
    );
  }

  const cookieValue = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!cookieValue) {
    return Promise.resolve(
      NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing admin_token cookie' } },
        { status: 401 }
      )
    );
  }

  // verifyAdminToken is async on Web Crypto (Edge-safe). Errors are caught
  // and translated to 401 — never leak internal stack traces.
  return verifyAdminToken(adminSecret, cookieValue).then((valid) => {
    if (!valid) {
      console.warn('[IRON_GATE] Admin API request rejected — invalid token.', {
        path: request.nextUrl.pathname,
        ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      });
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired admin_token' } },
        { status: 401 }
      );
    }
    return null;
  }).catch((err) => {
    console.error('[IRON_GATE] verifyAdminToken threw — rejecting as 401:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired admin_token' } },
      { status: 401 }
    );
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── IRON GATE: /api/admin/* (EXCEPT login/validate/change-password) ─
  // /api/admin/validate is the *pre-login* credential check used by the
  // login page itself, so it MUST be reachable without a valid
  // admin_token cookie.
  // /api/admin/login is the credential-submission endpoint (issues the
  // HMAC token).
  // /api/admin/change-password is the operator's post-login self-service
  // password rotation endpoint. Bypassing the CSRF origin check here is
  // SAFE because the route's very first action is `requireAdminAuth(req)`,
  // which validates the HMAC-signed `admin_token` cookie. An attacker
  // without a valid cookie cannot reach the handler regardless of the
  // Origin header. (REPARK 6.0 — 2026-07-29 directive.)
  if (
    pathname.startsWith('/api/admin') &&
    pathname !== '/api/admin/login' &&
    pathname !== '/api/admin/validate' &&
    pathname !== '/api/admin/change-password'
  ) {
    // CSRF gate: state-changing requests must come from a trusted origin.
    if (!isOriginAllowed(request)) {
      console.warn('[IRON_GATE] Admin mutation rejected — bad origin.', {
        path: pathname,
        method: request.method,
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
        ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CSRF_BLOCKED',
            message: 'Cross-origin admin request rejected.',
          },
        },
        { status: 403 }
      );
    }

    const gate = await checkAdminApiToken(request);
    if (gate) return gate;
  }

  // ── Admin UI pages: redirect to login if cookie missing OR token invalid ─────
  // Previous version only checked cookie presence — an attacker forging a
  // bogus admin_token cookie could reach the /admin page (UI would silently
  // show the dashboard, then bounce on the first API call). We now verify the
  // HMAC signature here as well so the page itself reflects the real auth
  // state instead of leaking dashboard bits to anonymous visitors.
  //
  // The verifyAdminToken helper honours the dev-bypass token
  // (`admin_token=authenticated`) when isAdminDevBypass() is true, so the
  // /admin UI and /api/admin/* gates stay in lockstep.
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const adminSecret = process.env.ADMIN_SECRET_KEY;
    const adminCookie = request.cookies.get(ADMIN_COOKIE);
    const cookieValue = adminCookie?.value;
    const adminOk = await (async () => {
      if (!cookieValue) return false;
      try {
        return await verifyAdminToken(adminSecret, cookieValue);
      } catch {
        return false;
      }
    })();
    if (!adminOk) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    return NextResponse.next();
  }

  // ── Client-facing battle page: require auth cookie ─────────────────────
  if (pathname === '/battle') {
    const authCookie = request.cookies.get(getAuthCookieName());
    if (!authCookie || !authCookie.value?.trim()) {
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.next();
      }
      return NextResponse.redirect(new URL(getLoginUrl(request), request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Match admin API, admin UI, and the public battle page.
  // Public game APIs (e.g. /api/game/init, /api/boss/status) are NOT
  // gated here — each handler is responsible for its own auth.
  matcher: [
    '/api/admin/:path*',
    '/admin/:path*',
    '/battle',
  ],
};