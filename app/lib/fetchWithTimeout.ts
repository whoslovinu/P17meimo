/**
 * fetchWithTimeout — 合同级网络层封装
 * ────────────────────────────────────────────────────────────────────────
 * 任何前端代码必须使用此函数而非裸 fetch()。原因：
 *
 *   1. **AbortController 强制挂载** — 防止悬空请求导致状态错乱
 *   2. **超时统一默认值 8s** — 生产模式 P99 < 2s，8s 留 4× safety margin
 *      (SSH 隧道、CDN 回源、首次 TLS 握手、慢用户网络的最大公约数)
 *   3. **错误归一化** — 把超时 / 网络失败 / 非 2xx / JSON 解析失败
 *      全部翻译为可识别的 FetchError 子类型，调用方无需再写 if-else
 *   4. **自动 trace ID** — 每个请求分配 `_reqId`，服务端日志可对账
 *
 * 使用约束：
 *   - 设置 `timeoutMs: 0` 将禁用超时（仅限轮询等有自清理的场景）
 *   - 调用方拿到的 `error instanceof FetchError` 即代表需要 toast/降级
 *   - `signal` 可由外部传入做组件卸载时的批量取消
 */

export type FetchErrorKind =
  | 'TIMEOUT'           // timeout 触发 → AbortError
  | 'NETWORK'           // fetch() 抛 TypeError（offline / DNS / CORS）
  | 'HTTP_NON_2XX'      // 4xx / 5xx
  | 'BAD_JSON'          // 响应不是合法 JSON（常见：HTML 500 错误页）
  | 'ABORTED';          // 外部 signal 触发 cancel

export interface FetchErrorPayload {
  kind: FetchErrorKind;
  status?: number;          // 仅 HTTP_NON_2XX
  statusText?: string;      // 仅 HTTP_NON_2XX
  bodyPreview?: string;     // 截前 300 字符，便于诊断
  /** Structured body when server returned valid JSON (e.g. {ok:false,error:{code,message}}). */
  parsed?: unknown;
  retryable: boolean;       // 推荐自动重试与否
  reqId: string;
  url: string;
  method: string;
  elapsedMs: number;
  cause?: string;           // 原始错误信息
}

export class FetchError extends Error {
  readonly payload: FetchErrorPayload;
  constructor(payload: FetchErrorPayload) {
    super(`[${payload.kind}] ${payload.method} ${payload.url} → ${payload.cause ?? payload.statusText ?? 'n/a'}`);
    this.name = 'FetchError';
    this.payload = payload;
  }
}

export interface FetchWithTimeoutOptions extends Omit<RequestInit, 'signal'> {
  /** 超时毫秒。0 = 禁用。默认 8000。 */
  timeoutMs?: number;
  /** 外部 signal — 组件卸载时会触发 abort。 */
  signal?: AbortSignal;
  /** 强制走非 JSON 响应（默认 false，会按 JSON 解析失败抛 BAD_JSON）。 */
  rawResponse?: boolean;
  /** 自定义 reqId 头名字，默认 x-client-req-id。 */
  reqIdHeader?: string;
}

export interface FetchWithTimeoutResult<T> {
  ok: boolean;
  status: number;
  statusText: string;
  data: T | null;
  raw: Response;
  reqId: string;
  elapsedMs: number;
}

let __reqCounter = 0;
function nextReqId(): string {
  __reqCounter = (__reqCounter + 1) & 0xffffff;
  return `${Date.now().toString(36)}-${__reqCounter.toString(36)}`;
}

/**
 * 核心函数。
 *
 * @example
 *   const { data } = await fetchWithTimeout<{ ok: boolean }>('/api/battle/init');
 *   if (data?.ok) { ... }
 */
export async function fetchWithTimeout<T = unknown>(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<FetchWithTimeoutResult<T>> {
  const {
    timeoutMs = 8000,
    signal: externalSignal,
    rawResponse = false,
    reqIdHeader = 'x-client-req-id',
    headers,
    method = 'GET',
    ...rest
  } = options;

  const reqId = nextReqId();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. 合并 abort —— 外部 + 内部 timeout
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new DOMException('Timeout', 'TimeoutError'));
    }, timeoutMs);
  }

  // 2. 注入 reqId 头（后端可按此串日志）
  const finalHeaders = new Headers(headers);
  finalHeaders.set(reqIdHeader, reqId);

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      method,
      headers: finalHeaders,
      signal: controller.signal,
      cache: rest.cache ?? 'no-store',
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
    const isExternalAbort = !!(externalSignal?.aborted);
    if (isAbort && !isExternalAbort) {
      throw new FetchError({
        kind: 'TIMEOUT',
        retryable: true,
        reqId,
        url,
        method,
        elapsedMs,
        cause: `aborted after ${timeoutMs}ms`,
      });
    }
    if (isExternalAbort) {
      throw new FetchError({
        kind: 'ABORTED',
        retryable: false,
        reqId,
        url,
        method,
        elapsedMs,
        cause: 'external abort',
      });
    }
    throw new FetchError({
      kind: 'NETWORK',
      retryable: true,
      reqId,
      url,
      method,
      elapsedMs,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (timer) clearTimeout(timer);
  if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;

  // 3. 非 2xx
  if (!res.ok) {
    let bodyPreview: string | undefined;
    let parsedBody: unknown;
    try {
      const rawText = (await res.text()).slice(0, 300);
      bodyPreview = rawText;
      try { parsedBody = JSON.parse(rawText); } catch { /* not JSON */ }
    } catch { /* ignore */ }
    throw new FetchError({
      kind: 'HTTP_NON_2XX',
      status: res.status,
      statusText: res.statusText,
      bodyPreview,
      parsed: parsedBody,
      retryable: res.status >= 500, // 5xx 可重试，4xx 多为业务错误不重试
      reqId,
      url,
      method,
      elapsedMs,
    });
  }

  // 4. 2xx — 按 rawResponse 选择
  let data: T | null = null;
  if (!rawResponse) {
    try {
      data = (await res.json()) as T;
    } catch (err) {
      let bodyPreview: string | undefined;
      try { bodyPreview = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new FetchError({
        kind: 'BAD_JSON',
        status: res.status,
        bodyPreview,
        retryable: false,
        reqId,
        url,
        method,
        elapsedMs,
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    status: res.status,
    statusText: res.statusText,
    data,
    raw: res,
    reqId,
    elapsedMs,
  };
}

/**
 * 便捷 helper：把 FetchError 翻译成用户可读的中文短句。
 *
 * @example
 *   try { await fetchWithTimeout(...) }
 *   catch (e) { toast.error(humanizeFetchError(e), 4000) }
 */
export function humanizeFetchError(err: unknown): string {
  if (err instanceof FetchError) {
    switch (err.payload.kind) {
      case 'TIMEOUT':       return '网络超时，请重试';
      case 'NETWORK':       return '网络异常，请检查连接';
      case 'HTTP_NON_2XX':
        if (err.payload.status === 429) return '操作太频繁，请稍后再试';
        // REPARK 6.0 (2026-07-29): /api/admin/login returns 401 specifically
        // for a *wrong password* the operator just typed. That 401 has
        // nothing to do with an expired session and must NOT show
        // "请先登录" / "登录会话已失效". Detect by URL.
        if (err.payload.status === 401 || err.payload.status === 403) {
          if (err.payload.url.includes('/api/admin/login')) {
            return '密码错误，请核对后重新输入';
          }
          return '请先登录';
        }
        if (err.payload.status && err.payload.status >= 500) return '服务器异常，请重试';
        return '请求失败，请重试';
      case 'BAD_JSON':      return '服务器异常，请稍后重试';
      case 'ABORTED':       return '请求已取消';
      default:              return '网络异常，请重试';
    }
  }
  return '网络异常，请重试';
}
