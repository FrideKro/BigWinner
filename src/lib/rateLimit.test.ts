import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  clearFailures,
  getClientIp,
  getRateLimitState,
  recordFailure,
} from './rateLimit';

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

  it('容量上限时逐出未锁定的新记录，锁定中的攻击者记录不被随机 key 洪水挤掉', () => {
    // 唯一锁定记录（真实攻击者）
    const victim = 'evict:victim';
    recordFailure(victim, 1);
    expect(getRateLimitState(victim).locked).toBe(true);

    // 用未锁定的普通失败记录灌满剩余容量
    const flood = Array.from({ length: 499 }, (_, i) => `evict:flood:${i}`);
    for (const k of flood) {
      recordFailure(k, 5);
    }

    // 洪水继续灌入：逐出的只会是未锁定记录，victim 的锁定保留
    for (let i = 0; i < 50; i += 1) {
      recordFailure(`evict:wave:${i}`, 5);
      expect(getRateLimitState(victim).locked).toBe(true);
    }

    clearFailures(victim);
    for (const k of flood) clearFailures(k);
    for (let i = 0; i < 50; i += 1) clearFailures(`evict:wave:${i}`);
  });

  it('全部条目处于锁定中的极端场景下退回逐出插入序最新者', () => {
    const keys = Array.from({ length: 501 }, (_, i) => `evict:locked:${i}`);
    for (let i = 0; i < 500; i += 1) {
      recordFailure(keys[i], 1);
    }

    // 插入第 501 个键：全部已锁定无从按「未锁定优先」，退回逐出最新的 keys[499]
    recordFailure(keys[500], 1);
    expect(getRateLimitState(keys[499]).locked).toBe(false);
    expect(getRateLimitState(keys[0]).locked).toBe(true);
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

// 全量请求限速与失败计数分开记账，各用例使用独立 key 避免与上方用例串扰
describe('checkRateLimit 全量请求限速', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内前 max 个请求放行，第 max+1 个起拒绝并锁定一个窗口', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit('rate:full-a', 3)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    expect(checkRateLimit('rate:full-a', 3)).toEqual({
      allowed: false,
      retryAfterSeconds: 15 * 60,
    });
  });

  it('窗口滑动后重新计数放行', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('rate:full-b', 3);
    expect(checkRateLimit('rate:full-b', 3).allowed).toBe(false);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(checkRateLimit('rate:full-b', 3)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('不同 key 相互独立', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('rate:full-c1', 3);
    expect(checkRateLimit('rate:full-c1', 3).allowed).toBe(false);
    expect(checkRateLimit('rate:full-c2', 3)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('与失败计数独立记账：clearFailures 不重置限速进度', () => {
    const key = 'rate:full-d';
    recordFailure(key, 5);
    clearFailures(key);

    checkRateLimit(key, 2);
    checkRateLimit(key, 2);
    expect(checkRateLimit(key, 2).allowed).toBe(false);
  });
});
