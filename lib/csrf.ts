/**
 * lib/csrf.ts — Same-origin gate for state-changing admin requests.
 *
 * Why a separate module: the function is pure (input request → boolean)
 * and we want to unit-test it without booting the Edge runtime. The
 * middleware imports it from here and re-exports nothing.
 *
 * Threat model: the admin_token cookie is SameSite=Strict, which already
 * blocks most browser-initiated cross-site POSTs. But Same-Origin XSS,
 * a confused deputy, or a malicious browser extension can still forge
 * requests WITH the cookie attached. An Origin / Referer check is the
 * standard belt-and-suspenders defense.
 *
 * Policy:
 *   • GET / HEAD / OPTIONS            → always allowed (read-only).
 *   • POST/PUT/PATCH/DELETE w/ Origin → allowed if Origin matches the
 *     request's own origin OR appears in NEXT_PUBLIC_ADMIN_TRUSTED_ORIGINS.
 *   • POST/PUT/PATCH/DELETE w/ Referer → allowed if Referer's origin
 *     matches the request's origin OR appears in the allow-list.
 *   • POST/PUT/PATCH/DELETE w/o Origin AND w/o Referer:
 *       - PRODUCTION:  rejected (strong forgery signal — browsers always
 *         send Origin on state-changing requests).
 *       - DEV/TEST:    allowed (Node fetch() does not emit Origin, and
 *         the smoke suite relies on this to exercise mutation paths).
 *
 * Config:
 *   NEXT_PUBLIC_ADMIN_TRUSTED_ORIGINS  — comma-separated additional
 *     origins to trust (e.g. "https://admin.example.com").
 */

/** Methods that can mutate server state. */
export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Minimal request shape needed by isOriginAllowed. */
export interface CsrfRequestLike {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}

export interface CsrfPolicyEnv {
  nodeEnv?: string;
  trustedOrigins?: string;
}

function buildAllowList(trustedOrigins?: string): string[] {
  return (trustedOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Compare two origin strings by HOSTNAME ONLY (ignoring protocol and port).
 *
 * Per REPARK 6.0 directive: "只要 Origin 或 Referer 的 Host（IP 地址或域名）
 * 与当前请求的 Host Header 匹配，即视为同源合法请求".
 *
 * Why hostname-only (not `new URL().host`): `host` INCLUDES non-default ports,
 * so e.g. `http://98.93.252.250:3000` → host `'98.93.252.250:3000'`
 * but nginx's `proxy_set_header Host $host` strips the default port and yields
 * just `'98.93.252.250'`. We compare hostnames (e.g. `'98.93.252.250'`) so this
 * pair is treated as same-origin.
 *
 * Examples considered SAME hostname:
 *   http://98.93.252.250:3000      ↔ http://98.93.252.250
 *   https://admin.example.com      ↔ http://admin.example.com
 *   http://localhost:3000          ↔ http://localhost:80
 */
function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostnameMatches(a: string, b: string): boolean {
  const ha = hostnameOf(a);
  const hb = hostnameOf(b);
  return ha.length > 0 && ha === hb;
}

export function isOriginAllowed(
  request: CsrfRequestLike,
  env: CsrfPolicyEnv = {
    nodeEnv: typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
    trustedOrigins: typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_ADMIN_TRUSTED_ORIGINS
      : undefined,
  }
): boolean {
  // The "request origin" is derived from the request URL — but in Edge/Node
  // middleware this reflects the *server-side* host (e.g. localhost:3000),
  // NOT the public host the browser sees. So we compute BOTH a strict
  // equality against request.url AND a host-only fallback against the
  // incoming Host header.
  const requestOrigin = (() => {
    try {
      return new URL(request.url).origin;
    } catch {
      return '';
    }
  })();

  const incomingHostHeader = request.headers.get('host') ?? '';
  const headerOrigin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const isProd = env.nodeEnv === 'production';
  const allowList = buildAllowList(env.trustedOrigins);

  // Read-only methods always pass.
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return true;

  // ── Helper: decide whether a candidate origin (parsed from header) is trusted.
  const isCandidateTrusted = (candidateOrigin: string): boolean => {
    // 1. Strict full-origin equality against request URL (typical Node runtime).
    if (candidateOrigin === requestOrigin) return true;
    // 2. Hostname-only fallback against the incoming Host header.
    //    Covers Edge / proxied middleware where request.url uses the internal
    //    listen address (e.g. localhost:3000) but browsers see the public
    //    host (e.g. 98.93.252.250). Hostname comparison ignores port/protocol.
    if (incomingHostHeader && hostnameMatches(candidateOrigin, `http://${incomingHostHeader}`)) {
      return true;
    }
    // 3. Allow-list (env-configured NEXT_PUBLIC_ADMIN_TRUSTED_ORIGINS).
    return allowList.includes(candidateOrigin);
  };

  // 1. Origin header (preferred) — same-origin OR allow-listed OR host-match.
  if (headerOrigin) {
    return isCandidateTrusted(headerOrigin);
  }

  // 2. Referer fallback — same-origin OR allow-listed OR host-match.
  if (referer) {
    let refOrigin = '';
    try {
      refOrigin = new URL(referer).origin;
    } catch {
      // Malformed Referer — fall through to the no-Origin branch.
    }
    if (refOrigin && isCandidateTrusted(refOrigin)) return true;
    // Malformed Referer with no Origin → treat as forgery signal if prod.
  }

  // 3. No Origin AND no Referer on a state-changing request.
  //    Production: hard fail (forgery signal).
  //    Dev/test:   allow (Node fetch() doesn't emit Origin).
  if (isProd) {
    return false;
  }
  return true;
}