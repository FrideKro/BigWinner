'use client';

// 客户端取数封装：GET 短缓存 + 并发去重 + 统一 401 处理 + 安全的 AbortSignal 订阅解耦。
// 业务写操作成功后清空缓存，避免读到旧账本数据。

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * 判断是否为网络请求中止错误（用户主动取消、组件卸载、页面导航或浏览器隐式中止）
 */
export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  // 本封装抛出的 ApiError 携带服务端原文，即使文案恰好含 "abort" 也不是中止错误，不得被静默吞掉
  if (err instanceof ApiError) return false;
  if (
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    err.name === 'AbortError'
  ) {
    return true;
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (typeof err.message === 'string' && /abort/i.test(err.message)) return true;
  }
  if (typeof err === 'object') {
    const candidate = err as { name?: string; message?: string; code?: number };
    if (candidate.name === 'AbortError') return true;
    if (candidate.code === 20) return true;
    if (typeof candidate.message === 'string' && /abort/i.test(candidate.message)) return true;
  }
  return false;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

interface InflightEntry<T> {
  promise: Promise<T>;
  controller: AbortController;
  subscribers: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry<unknown>>();

const DEFAULT_TTL_MS = 30_000;
// 缓存容量上限：长会话中 period/userId/offset 组合的 URL 会持续累积，
// 超限时先清已过期项、仍超限则按插入序逐出最旧项，防止内存无界增长
const MAX_CACHE_ENTRIES = 100;

function setCacheEntry(url: string, data: unknown, ttl: number): void {
  cache.set(url, { data, expiresAt: Date.now() + ttl });
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

function emitUnauthorized(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('bw:unauthorized'));
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(data.error || `请求失败（${res.status}）`, res.status);
}

export interface ApiGetOptions {
  /** 缓存时长，0 表示不缓存 */
  ttl?: number;
  /** 跳过缓存强制拉取 */
  force?: boolean;
  signal?: AbortSignal;
}

export async function apiGet<T>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const { ttl = DEFAULT_TTL_MS, force = false, signal } = options;

  if (signal?.aborted) {
    throw (
      signal.reason ||
      (typeof DOMException !== 'undefined'
        ? new DOMException('This operation was aborted', 'AbortError')
        : new Error('This operation was aborted'))
    );
  }

  if (!force) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data as T;
    }
  }

  // force 有意绕过 in-flight 去重：force 用于「写操作后强制刷新」，
  // 若复用写操作前发起的 in-flight 请求会拿到旧账本数据，宁可重复打一次网络
  let entry = !force ? (inflight.get(url) as InflightEntry<T> | undefined) : undefined;

  if (!entry) {
    const controller = new AbortController();
    const requestPromise = (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (res.status === 401) {
          emitUnauthorized();
          throw new ApiError('登录已失效，请重新登录', 401);
        }
        if (!res.ok) {
          throw await toApiError(res);
        }
        const data = (await res.json()) as T;
        if (ttl > 0) {
          setCacheEntry(url, data, ttl);
        }
        return data;
      } finally {
        if (inflight.get(url)?.controller === controller) {
          inflight.delete(url);
        }
      }
    })();

    // 避免底层的 AbortError 在所有订阅者解绑后触发未捕获 promise rejection
    requestPromise.catch(() => {});

    entry = {
      promise: requestPromise,
      controller,
      subscribers: 0,
    };
    inflight.set(url, entry as InflightEntry<unknown>);
  }

  const currentEntry = entry;
  currentEntry.subscribers++;

  if (!signal) {
    try {
      return await currentEntry.promise;
    } finally {
      currentEntry.subscribers--;
    }
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      currentEntry.subscribers--;
      // 仅当所有订阅者都取消时，才中止底层网络 fetch
      if (currentEntry.subscribers <= 0) {
        currentEntry.controller.abort(
          signal.reason ||
            (typeof DOMException !== 'undefined'
              ? new DOMException('This operation was aborted', 'AbortError')
              : new Error('This operation was aborted')),
        );
        if (inflight.get(url)?.controller === currentEntry.controller) {
          inflight.delete(url);
        }
      }
      reject(
        signal.reason ||
          (typeof DOMException !== 'undefined'
            ? new DOMException('This operation was aborted', 'AbortError')
            : new Error('This operation was aborted')),
      );
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    currentEntry.promise.then(
      (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        currentEntry.subscribers--;
        resolve(data);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        currentEntry.subscribers--;
        reject(err);
      },
    );
  });
}

export async function apiMutate<T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(url, {
    method,
    signal: options.signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    emitUnauthorized();
    throw new ApiError('登录已失效，请重新登录', 401);
  }
  if (!res.ok) {
    throw await toApiError(res);
  }

  const data = (await res.json().catch(() => ({}))) as T;
  // 写操作后所有列表/统计都可能变化，直接清空客户端缓存
  invalidateApiCache();
  return data;
}
