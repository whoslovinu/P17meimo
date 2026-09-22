/**
 * handleAdminUnauthorized — Admin 区 401 鉴权失败的优雅拦截器
 * ──────────────────────────────────────────────────────────────────
 *
 * 当 /api/admin/* 任意端点因 IRON_GATE 拦截返回 401 时（HMAC cookie
 * 缺失 / 过期 / 篡改），UI 不应给用户展示硬核错误栈，而应温和提示
 * 并引导重新登录。
 *
 * 重要：change-password 路由的 401 表示 "旧密码不正确"，是业务错误
 * 不是会话失效。它返回的 body 形如 `{ok:false, error:{code:"OLD_PASSWORD_MISMATCH"}}`，
 * 与 IRON_GATE 的 `{ok:false, error:{code:"UNAUTHORIZED"}}` 明确可区分。
 * 我们只在后者出现时触发重定向，避免误把"旧密码错误"踢去登录页。
 *
 * 触发流程：
 *   1. 弹 Toast "登录会话已失效，请重新登录"
 *   2. 清除 localStorage['admin_session']
 *   3. 1 秒后 window.location.href = '/admin/login'
 *
 * 使用方式：在 admin/layout.tsx 的 useEffect 里给 window.fetch 套一层
 * 拦截器（覆盖所有 /api/admin/* 请求），无需逐页面修改。
 */
import { FetchError } from '@/app/lib/fetchWithTimeout';

const REDIRECT_DELAY_MS = 1000;
const TARGET_PATH = '/admin/login';
const SESSION_KEY = 'admin_session';

export interface AdminUnauthorizedBody {
  ok?: false;
  error?: { code?: string; message?: string };
  /** Edge middleware emits this flat shape (no `ok` field). */
  error_code?: string;
  message?: string;
}

function isAdminApiUrl(input: RequestInfo | URL): boolean {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return url.includes('/api/admin/');
}

/**
 * Detect whether a 401 response body indicates an expired / missing
 * admin session (as opposed to a business-level 401 like wrong password).
 *
 * Two body shapes are recognised:
 *
 *   1. The structured envelope used by `checkAdminApiToken()` in
 *      `middleware.ts`:
 *        { ok: false, error: { code: 'UNAUTHORIZED', message: '…' } }
 *
 *   2. The flat envelope used by the legacy fallback in `middleware.ts`
 *      (returned when the JSON parse above throws on an unexpected
 *      payload, or by the CSRF-gate-then-middleware fallthrough):
 *        { error: 'Unauthorized Access' }
 *        { error: 'Invalid or expired admin_token' }
 *
 * Excludes `OLD_PASSWORD_MISMATCH` (from change-password) and `'密码错误'`
 * (from /api/admin/login) — those are business errors that must stay on
 * the current page.
 */
function isSessionExpiredBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as AdminUnauthorizedBody;
  const code = b.error?.code ?? b.error_code ?? '';
  if (code === 'UNAUTHORIZED') return true;

  // Flat fallback shape: middleware emits { error: "Unauthorized Access" }
  // or { error: "Invalid or expired admin_token" } from its catch-all
  // branches. Either of those means session-expired.
  const flatErr = b.error;
  if (typeof flatErr === 'string') {
    if (/^(Unauthorized Access|Invalid or expired admin_token|Missing admin_token)/i.test(flatErr)) {
      return true;
    }
  }
  return false;
}

/**
 * Inspect a fetch Response: if it's an /api/admin/* 401 with
 * UNAUTHORIZED code, kick off the redirect flow. Safe to call from
 * any catch site — returns synchronously, never throws.
 */
export async function maybeHandleAdminUnauthorizedResponse(
  res: Response,
): Promise<void> {
  if (res.status !== 401) return;
  if (!isAdminApiUrl(res.url)) return;

  // Clone so callers can still parse the body themselves.
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    // Body wasn't JSON — fall back to text peek (middleware flat shape).
    try {
      const txt = await res.clone().text();
      if (/UNAUTHORIZED|expired admin_token|Unauthorized Access/i.test(txt)) {
        body = { error: 'Unauthorized Access' };
      }
    } catch {
      /* ignore — treat as not-session-expired */
    }
  }
  if (!isSessionExpiredBody(body)) return;

  triggerSessionExpiredRedirect();
}

/**
 * Inspect a thrown FetchError: if it represents an admin 401 with
 * UNAUTHORIZED code, kick off the redirect flow.
 */
export function maybeHandleAdminUnauthorizedError(err: unknown): boolean {
  if (!(err instanceof FetchError)) return false;
  if (err.payload.kind !== 'HTTP_NON_2XX') return false;
  if (err.payload.status !== 401) return false;
  // url is part of FetchErrorPayload; admin routes always include '/api/admin/'.
  if (!err.payload.url.includes('/api/admin/')) return false;

  // bodyPreview contains the first 300 chars — enough to spot "UNAUTHORIZED".
  const preview = err.payload.bodyPreview ?? '';
  if (/OLD_PASSWORD_MISMATCH/.test(preview)) return false;
  if (!/(UNAUTHORIZED|expired admin_token)/i.test(preview)) return false;

  triggerSessionExpiredRedirect();
  return true;
}

let __redirectScheduled = false;

function triggerSessionExpiredRedirect() {
  if (typeof window === 'undefined') return;
  if (__redirectScheduled) return;
  __redirectScheduled = true;

  // Clear client-side session marker (IRON_GATE uses HttpOnly cookie so
  // there's nothing else to clear; but the UI-side hint matters).
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* localStorage may be disabled — non-fatal */
  }

  // Toast: we import lazily to avoid SSR pulling react-hot-toast.
  void import('react-hot-toast').then(({ default: toast }) => {
    toast.error('登录会话已失效，请重新登录', { duration: 1800 });
  });

  window.setTimeout(() => {
    window.location.href = TARGET_PATH;
  }, REDIRECT_DELAY_MS);
}

/**
 * Test/debug helper — exposes the internal "scheduled" flag so unit
 * tests can reset it between cases.
 */
export function __resetSessionExpiredRedirectFlag(): void {
  __redirectScheduled = false;
}