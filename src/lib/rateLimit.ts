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

export function recordFailure(key: string): void {
  const now = Date.now();
  if (attempts.size >= MAX_ENTRIES) {
    cleanupExpired(now);
  }

  const rec = attempts.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }

  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = now + LOCK_MS;
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
