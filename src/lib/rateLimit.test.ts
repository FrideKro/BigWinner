import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFailures, getRateLimitState, recordFailure } from './rateLimit';

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
});
