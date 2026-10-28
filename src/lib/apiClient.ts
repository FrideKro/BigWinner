'use client';

// 客户端取数封装：GET 短缓存 + 并发去重 + 统一 401 处理。
// 业务写操作成功后清空缓存，避免读到旧账本数据。

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 30_000;

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
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

  if (!force) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data as T;
    }
    const pending = inflight.get(url);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const request = (async () => {
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (res.status === 401) {
      emitUnauthorized();
      throw new ApiError('登录已失效，请重新登录', 401);
    }
    if (!res.ok) {
      throw await toApiError(res);
    }
    const data = (await res.json()) as T;
    if (ttl > 0) {
      cache.set(url, { data, expiresAt: Date.now() + ttl });
    }
    return data;
  })();

  inflight.set(url, request);
  try {
    return await request;
  } finally {
    inflight.delete(url);
  }
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
