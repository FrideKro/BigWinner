import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiGet, apiMutate, invalidateApiCache, isAbortError, ApiError } from './apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    invalidateApiCache();
    vi.restoreAllMocks();
  });

  describe('isAbortError', () => {
    it('正确识别各环境下的 AbortError', () => {
      expect(isAbortError(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
      expect(isAbortError(new DOMException('signal is aborted without reason', 'AbortError'))).toBe(
        true,
      );

      const customAbort = new Error('signal is aborted without reason');
      expect(isAbortError(customAbort)).toBe(true);

      const namedAbort = new Error('aborted');
      namedAbort.name = 'AbortError';
      expect(isAbortError(namedAbort)).toBe(true);

      const browserMsg = new Error('The user aborted a request.');
      expect(isAbortError(browserMsg)).toBe(true);

      const codeAbort = { code: 20, message: 'aborted' };
      expect(isAbortError(codeAbort)).toBe(true);

      expect(isAbortError(new Error('Network error'))).toBe(false);
      expect(isAbortError(new ApiError('Not found', 404))).toBe(false);
      expect(isAbortError(new ApiError('request aborted by server', 500))).toBe(false);
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
    });
  });

  describe('apiGet 缓存与去重', () => {
    it('基础成功请求并支持 TTL 缓存', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ count: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res1 = await apiGet<{ count: number }>('/api/test-cache', { ttl: 5000 });
      expect(res1).toEqual({ count: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 第二次在 TTL 内命中缓存，不发起 fetch
      const res2 = await apiGet<{ count: number }>('/api/test-cache');
      expect(res2).toEqual({ count: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // force 强制拉取跳过缓存
      const res3 = await apiGet<{ count: number }>('/api/test-cache', { force: true });
      expect(res3).toEqual({ count: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('并发请求自动合并去重', async () => {
      let resolvePromise: (val: unknown) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const mockFetch = vi.fn().mockImplementation(() => deferred);
      vi.stubGlobal('fetch', mockFetch);

      const p1 = apiGet<{ name: string }>('/api/dedup');
      const p2 = apiGet<{ name: string }>('/api/dedup');

      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolvePromise!({
        ok: true,
        status: 200,
        json: async () => ({ name: 'winner' }),
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual({ name: 'winner' });
      expect(r2).toEqual({ name: 'winner' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('缓存超过容量上限时逐出最旧条目，防止长会话内存无界增长', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // 灌入 101 条缓存：插入第 101 条时超限，逐出最早插入的第 0 条
      for (let i = 0; i <= 100; i += 1) {
        await apiGet(`/api/cache-cap:${i}`, { ttl: 60000 });
      }
      expect(mockFetch).toHaveBeenCalledTimes(101);

      // 第 0 条已被逐出：再次请求重新 fetch（此次插入又会逐出当时的第 1 条）
      await apiGet('/api/cache-cap:0', { ttl: 60000 });
      expect(mockFetch).toHaveBeenCalledTimes(102);

      // 第 2 条仍在缓存内：不重新 fetch
      await apiGet('/api/cache-cap:2', { ttl: 60000 });
      expect(mockFetch).toHaveBeenCalledTimes(102);
    });
  });

  describe('apiGet 与 AbortSignal 订阅解耦（核心修复验证）', () => {
    it('调用方 1 中止时，共享该 inflight 的调用方 2 不受影响并能正常获得数据', async () => {
      let resolveFetch: (val: unknown) => void;
      const deferred = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      const mockFetch = vi.fn().mockImplementation(() => deferred);
      vi.stubGlobal('fetch', mockFetch);

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      // 调用方 1 与调用方 2 发起相同 URL 请求
      const p1 = apiGet<{ status: string }>('/api/shared', { signal: controller1.signal });
      const p2 = apiGet<{ status: string }>('/api/shared', { signal: controller2.signal });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 中止调用方 1（如组件重新渲染、切换筛选等触发 abortRef.current.abort()）
      controller1.abort();

      // 调用方 1 应立即被拒绝为 AbortError
      await expect(p1).rejects.toSatisfy((err) => isAbortError(err));

      // 底层 fetch 此时不应被 abort，因为调用方 2 仍在等待
      resolveFetch!({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success' }),
      });

      // 调用方 2 必须正常接收到数据，不能报 'signal is aborted without reason'
      const r2 = await p2;
      expect(r2).toEqual({ status: 'success' });
    });

    it('无 signal 的调用方与有 signal 的调用方共享时，signal 中止不影响无 signal 调用方', async () => {
      let resolveFetch: (val: unknown) => void;
      const deferred = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      const mockFetch = vi.fn().mockImplementation(() => deferred);
      vi.stubGlobal('fetch', mockFetch);

      const controller1 = new AbortController();

      const p1 = apiGet<{ data: number }>('/api/shared-mix', { signal: controller1.signal });
      const p2 = apiGet<{ data: number }>('/api/shared-mix'); // 无 signal

      controller1.abort();
      await expect(p1).rejects.toSatisfy((err) => isAbortError(err));

      resolveFetch!({
        ok: true,
        status: 200,
        json: async () => ({ data: 42 }),
      });

      const r2 = await p2;
      expect(r2).toEqual({ data: 42 });
    });

    it('所有活跃订阅者均中止时，底层 HTTP 请求被中止以节约资源', async () => {
      let abortCaptured = false;
      const mockFetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          abortCaptured = true;
        });
        return new Promise(() => {}); // 挂起
      });
      vi.stubGlobal('fetch', mockFetch);

      const controller1 = new AbortController();
      const p1 = apiGet('/api/all-aborted', { signal: controller1.signal });

      expect(abortCaptured).toBe(false);

      controller1.abort();
      await expect(p1).rejects.toSatisfy((err) => isAbortError(err));

      // 唯一的订阅者已取消，底层 fetch 必须被通知 abort
      expect(abortCaptured).toBe(true);
    });

    it('若传入已 aborted 的 signal，立即抛出错误且不触发 fetch', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const controller = new AbortController();
      controller.abort();

      await expect(apiGet('/api/already-aborted', { signal: controller.signal })).rejects.toSatisfy(
        (err) => isAbortError(err),
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('401 会话失效统一处理', () => {
    it('接口返回 401 时广播 bw:unauthorized 事件并抛出 ApiError', async () => {
      const unauthorizedListener = vi.fn();
      window.addEventListener('bw:unauthorized', unauthorizedListener);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: '未登录' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(apiGet('/api/protected')).rejects.toThrow(ApiError);
      expect(unauthorizedListener).toHaveBeenCalledTimes(1);

      window.removeEventListener('bw:unauthorized', unauthorizedListener);
    });
  });

  describe('apiMutate 写操作与缓存失效', () => {
    it('写操作清空缓存与 inflight 映射', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // 先填充缓存
      await apiGet('/api/items', { ttl: 60000 });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 写操作
      await apiMutate('/api/items', 'POST', { name: 'new item' });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // 再次 GET 应当重新拉取而非读缓存
      await apiGet('/api/items');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
