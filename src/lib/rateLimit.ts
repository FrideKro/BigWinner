// 进程内登录限流：滑动窗口失败计数 + 临时锁定。
// 无外部依赖，单实例部署（docker compose 单容器）下有效；重启后计数重置。
interface AttemptRecord {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 失败计数窗口：15 分钟
const MAX_FAILURES = 5; // 窗口内允许的最大失败次数
const LOCK_MS = 15 * 60 * 1000; // 触发限流后的锁定时长
const MAX_ENTRIES = 500; // 记录条数上限，超出时清理过期项防内存膨胀

const attempts = new Map<string, AttemptRecord>();

function cleanupExpired(now: number): void {
  for (const [key, rec] of attempts) {
    if (rec.lockedUntil <= now && now - rec.windowStart > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export interface RateLimitState {
  locked: boolean;
  retryAfterSeconds: number;
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim().slice(0, 64) : '';
}

export function getRateLimitState(key: string): RateLimitState {
  const rec = attempts.get(key);
  if (!rec) {
    return { locked: false, retryAfterSeconds: 0 };
  }
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterSeconds: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export function recordFailure(key: string, maxFailures = MAX_FAILURES): void {
  const now = Date.now();
  if (attempts.size >= MAX_ENTRIES) {
    cleanupExpired(now);
    if (attempts.size >= MAX_ENTRIES && !attempts.has(key)) {
      const oldestKey = attempts.keys().next().value;
      if (oldestKey !== undefined) {
        attempts.delete(oldestKey);
      }
    }
  }

  const rec = attempts.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    attempts.set(key, {
      count: 1,
      windowStart: now,
      lockedUntil: 1 >= maxFailures ? now + LOCK_MS : 0,
    });
    return;
  }

  rec.count += 1;
  if (rec.count >= maxFailures) {
    rec.lockedUntil = now + LOCK_MS;
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

// ---------------------------------------------------------------------------
// 全量请求限速（成功请求也计数）：公开数据接口防脚本化刷库。
// 与上方失败计数分开记账：失败限流只在出错时累加、成功即清零；
// 这里对每个请求都计数，正常访客不会清零，阈值须远高于单人正常会话用量
// ---------------------------------------------------------------------------
interface RateRecord {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const rateBuckets = new Map<string, RateRecord>();

export interface RateCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** 滑动窗口内的全量请求计数：窗口内第 max+1 个请求起拒绝并锁定一个窗口时长 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number = WINDOW_MS,
): RateCheckResult {
  const now = Date.now();
  if (rateBuckets.size >= MAX_ENTRIES) {
    for (const [k, rec] of rateBuckets) {
      if (rec.lockedUntil <= now && now - rec.windowStart > windowMs) {
        rateBuckets.delete(k);
      }
    }
    if (rateBuckets.size >= MAX_ENTRIES && !rateBuckets.has(key)) {
      const oldestKey = rateBuckets.keys().next().value;
      if (oldestKey !== undefined) {
        rateBuckets.delete(oldestKey);
      }
    }
  }

  const rec = rateBuckets.get(key);
  if (!rec || now - rec.windowStart > windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (rec.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((rec.lockedUntil - now) / 1000) };
  }

  rec.count += 1;
  if (rec.count > max) {
    rec.lockedUntil = now + windowMs;
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
