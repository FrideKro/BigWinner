import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFailures, getClientIp, getRateLimitState, recordFailure } from './rateLimit';

describe('rateLimit', () => {
  const KEY = 'login:test-user:1.2.3.4';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    clearFailures(KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('未记录失败时不锁定', () => {
    expect(getRateLimitState(KEY)).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  it('窗口内失败 4 次不锁定，第 5 次触发锁定 15 分钟', () => {
    for (let i = 0; i < 4; i += 1) {
      recordFailure(KEY);
      expect(getRateLimitState(KEY).locked).toBe(false);
    }
    recordFailure(KEY);

    const state = getRateLimitState(KEY);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(15 * 60);
  });

  it('锁定到期后自动解锁，且新失败从 1 重新计数', () => {
    for (let i = 0; i < 5; i += 1) {
      recordFailure(KEY);
    }
    expect(getRateLimitState(KEY).locked).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(getRateLimitState(KEY)).toEqual({ locked: false, retryAfterSeconds: 0 });

    recordFailure(KEY);
    expect(getRateLimitState(KEY).locked).toBe(false);
  });

  it('失败计数窗口滑过后重新计数，不立即锁定', () => {
    for (let i = 0; i < 4; i += 1) {
      recordFailure(KEY);
    }
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);

    recordFailure(KEY);
    expect(getRateLimitState(KEY).locked).toBe(false);
  });

  it('clearFailures 清除记录后立即可重试', () => {
    for (let i = 0; i < 5; i += 1) {
      recordFailure(KEY);
    }
    expect(getRateLimitState(KEY).locked).toBe(true);

    clearFailures(KEY);
    expect(getRateLimitState(KEY)).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  it('支持自定义阈值（账号全局键使用更高门槛）', () => {
    const globalKey = 'login:user:test-user';
    clearFailures(globalKey);

    for (let i = 0; i < 9; i += 1) {
      recordFailure(globalKey, 10);
    }
    expect(getRateLimitState(globalKey).locked).toBe(false);

    recordFailure(globalKey, 10);
    expect(getRateLimitState(globalKey).locked).toBe(true);
    clearFailures(globalKey);
  });

  it('窗口内活跃键达到 500 条上限时淘汰最早插入的键，防内存膨胀', () => {
    const keys = Array.from({ length: 501 }, (_, i) => `evict:key:${i}`);
    for (let i = 0; i < 500; i += 1) {
      recordFailure(keys[i], 1);
    }
    expect(getRateLimitState(keys[0]).locked).toBe(true);

    // 插入第 501 个键时，所有条目均未过期，应淘汰最早的 keys[0]
    recordFailure(keys[500], 1);
    expect(getRateLimitState(keys[0]).locked).toBe(false);
    expect(getRateLimitState(keys[500]).locked).toBe(true);

    for (const k of keys) {
      clearFailures(k);
    }
  });
});

describe('getClientIp', () => {
  it('提取 x-forwarded-for 首段并去除首尾空白', () => {
    const headers = new Headers({ 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.1 ' });
    expect(getClientIp(headers)).toBe('203.0.113.5');
  });

  it('未设置 x-forwarded-for 时返回空字符串', () => {
    expect(getClientIp(new Headers())).toBe('');
  });

  it('超长 IP 头截断到 64 字符', () => {
    const headers = new Headers({ 'x-forwarded-for': 'x'.repeat(120) });
    expect(getClientIp(headers)).toHaveLength(64);
  });
});
