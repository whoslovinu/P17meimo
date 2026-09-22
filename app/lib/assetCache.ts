/**
 * IndexedDB-backed asset cache for P17 H5meimo.
 *
 * 目的：解决 H5 资源在弱网下重复加载慢、退出重进需要重新下载的痛点。
 * - 拦截并缓存 Spine / PIXI 静态资源（`.skel` / `.atlas` / `.json` / `.png` / 纹理页）
 * - 任何缓存异常必须**静默降级为普通网络请求**，绝不容忍白屏
 * - 库名:`ReparkH5AssetCache` / Store 名:`blobs`(key=URL, value=Blob)
 *
 * DEPLOY NOTE: 这是无破坏性新增模块。运行时若 IndexedDB 不可用(隐私模式 / 配额满 /
 * 浏览器禁用 / 旧版 webview),`getCachedAsset` 会返回 `null`,`cacheAsset` 会返回 void,
 * 调用方走原 network 路径,不抛错、不阻塞、不白屏。
 */

const DB_NAME = 'ReparkH5AssetCache';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

let __dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (__dbPromise) return __dbPromise;
  __dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      } catch {
        // ignore
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return __dbPromise;
}

/**
 * 从 IndexedDB 读取某个 URL 的缓存 Blob。
 * 不存在 / 缓存层出错 → 返回 null(调用方应走网络)。
 */
export async function getCachedAsset(url: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(url);
        req.onsuccess = () => resolve((req.result as Blob) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/**
 * 把 fetch 拿到的 Blob 写入缓存。
 * 写入失败(配额满 / 隐私模式 / 浏览器禁用)→ 静默吞,不影响主流程。
 */
export async function cacheAsset(url: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(blob, url);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore
  }
}

/**
 * 判断 URL 是否应该走缓存拦截 —— 只针对本项目自身资源目录,避免污染其他网络请求。
 * 这是个**白名单**(而非黑名单):只缓存命中规则的 URL,其他 URL 全部走原始 fetch。
 */
export function isAssetUrl(url: string): boolean {
  if (!url) return false;
  // 只拦截同源 GET(简单判断:协议头 + 路径前缀)
  // - /H501/... → 魅魔姿态 / 背景 / 光环
  // - /spine/assets/... → 兜底 Spine 资源
  // - /meimo-silhouette.png → LoadingScreen fallback
  // - /ui/... → UI 武器图标
  return (
    url.startsWith('/H501/') ||
    url.startsWith('/spine/assets/') ||
    url.startsWith('/ui/') ||
    url.endsWith('.skel') ||
    url.endsWith('.atlas') ||
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.webp')
  );
}

/**
 * 一次性安装全局 fetch 拦截器,只针对 `isAssetUrl()` 命中的资源。
 * 命中缓存 → 直接返回 Blob(包装成 Response);
 * 未命中 → 走真实 fetch → 异步写入缓存(不阻塞当前请求)。
 *
 * 幂等:同一页面多次调用只生效一次。
 */
let __installed = false;
export function installAssetFetchInterceptor(): void {
  if (__installed) return;
  if (typeof window === 'undefined') return;
  if (typeof window.fetch !== 'function') return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    if (!url) return originalFetch(input, init);

    // 只读 GET 才拦截缓存
    const method = (init?.method ?? (input as Request)?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') return originalFetch(input, init);

    if (!isAssetUrl(url)) return originalFetch(input, init);

    try {
      const cached = await getCachedAsset(url);
      if (cached) {
        // 用缓存 Blob 构造 Response。Loader 把它当 response.body 用就行。
        return new Response(cached, {
          status: 200,
          statusText: 'OK (IDB)',
          headers: { 'Content-Type': cached.type || 'application/octet-stream' },
        });
      }
    } catch {
      // 缓存读失败 → 走网络
    }

    // 命中失败 → 真实网络请求
    const response = await originalFetch(input, init);

    // 异步后台写入缓存(不 await,不影响当前请求)
    if (response.ok) {
      try {
        const cloned = response.clone();
        // 不阻塞当前调用
        cloned
          .blob()
          .then((blob) => cacheAsset(url, blob))
          .catch(() => {
            // ignore
          });
      } catch {
        // ignore
      }
    }

    return response;
  };

  __installed = true;
}
