// 分享链接创建参数校验：/api/shares（POST）使用，纯函数无副作用
// 与 db.ts 中 share_links 表的 VARCHAR 长度保持一致
import { currentShanghaiDate, currentShanghaiYearMonth } from './gameLogic';

export const SHARE_SCOPES = ['board', 'games', 'stats'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export const SHARE_PERIOD_TYPES = ['period', 'range'] as const;
export type SharePeriodType = (typeof SHARE_PERIOD_TYPES)[number];

// 自定义时间段跨度上限（自然日，含首尾）
export const MAX_SHARE_RANGE_DAYS = 366;
// 自定义有效期上限（自然日），防止误设超长有效期
export const MAX_SHARE_EXPIRY_DAYS = 365;

/** 校验内容模块勾选：非空数组、白名单子集、去重保序；返回归一化结果或中文错误 */
export function validateShareScope(raw: unknown): { error?: string; scope: ShareScope[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '请至少选择一个分享内容', scope: [] };
  }
  const scope: ShareScope[] = [];
  for (const item of raw) {
    if (!SHARE_SCOPES.includes(item as ShareScope)) {
      return { error: '分享内容包含无效选项', scope: [] };
    }
    if (!scope.includes(item as ShareScope)) {
      scope.push(item as ShareScope);
    }
  }
  return { scope };
}

/** 校验时间段输入并归一化，返回中文错误或固化结果：
 *  - period：'all' | 'year' | 'month' | 'YYYY' | 'YYYY-MM'，动态周期（year/month）
 *    在此固化为创建时刻的具体年/月，访客看到的时间段不随后时间漂移
 *  - range：'YYYY-MM-DD' 起止，含结束当天，跨度最长 366 天 */
export function validateSharePeriodInput(raw: {
  periodType: unknown;
  period?: unknown;
  rangeStart?: unknown;
  rangeEnd?: unknown;
}): {
  error?: string;
  periodType: SharePeriodType;
  period: string;
  rangeStart: string;
  rangeEnd: string;
} {
  const periodType = raw.periodType;
  if (periodType === 'period') {
    const period = typeof raw.period === 'string' ? raw.period.trim() : '';
    if (period === 'all' || /^\d{4}$/.test(period) || /^(\d{4})-(0[1-9]|1[0-2])$/.test(period)) {
      return { periodType, period, rangeStart: '', rangeEnd: '' };
    }
    // 动态周期固化为创建时刻的具体值
    if (period === 'year' || period === 'month') {
      const { year, month } = currentShanghaiYearMonth();
      return {
        periodType,
        period: period === 'year' ? year : `${year}-${month}`,
        rangeStart: '',
        rangeEnd: '',
      };
    }
    return {
      error: '时间段无效，请重新选择',
      periodType,
      period: 'all',
      rangeStart: '',
      rangeEnd: '',
    };
  }
  if (periodType === 'range') {
    const rangeStart = typeof raw.rangeStart === 'string' ? raw.rangeStart.trim() : '';
    const rangeEnd = typeof raw.rangeEnd === 'string' ? raw.rangeEnd.trim() : '';
    if (
      !/^(\d{4})-(\d{2})-(\d{2})$/.test(rangeStart) ||
      !/^(\d{4})-(\d{2})-(\d{2})$/.test(rangeEnd)
    ) {
      return {
        error: '请选择完整的起止日期',
        periodType,
        period: 'all',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    const start = parseIsoCalendarDate(rangeStart);
    const end = parseIsoCalendarDate(rangeEnd);
    if (!start || !end) {
      return {
        error: '起止日期不存在，请重新选择',
        periodType,
        period: 'all',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    if (end.time < start.time) {
      return {
        error: '结束日期不能早于开始日期',
        periodType,
        period: 'all',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    // 区间天数（含首尾）：跨度超上限时拒绝，避免误生成超长区间分享
    const spanDays = Math.round((end.time - start.time) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > MAX_SHARE_RANGE_DAYS) {
      return {
        error: `自定义时间段最长支持 ${MAX_SHARE_RANGE_DAYS} 天`,
        periodType,
        period: 'all',
        rangeStart: '',
        rangeEnd: '',
      };
    }
    return { periodType, period: 'all', rangeStart, rangeEnd };
  }
  return {
    error: '请选择时间段类型',
    periodType: 'period',
    period: 'all',
    rangeStart: '',
    rangeEnd: '',
  };
}

/** 校验有效期：null / undefined / 'never' = 永久；否则为 'YYYY-MM-DD' 自然日（含当天，
 *  至当天 24:00 过期），不早于上海「今天」，最长一年后 */
export function validateShareExpiresOn(
  raw: unknown,
  now: Date = new Date(),
): { error?: string; expiresOn: string | null } {
  if (raw === null || raw === undefined || raw === 'never') {
    return { expiresOn: null };
  }
  if (typeof raw !== 'string' || !/^(\d{4})-(\d{2})-(\d{2})$/.test(raw)) {
    return { error: '有效期格式无效', expiresOn: null };
  }
  if (!parseIsoCalendarDate(raw)) {
    return { error: '有效期日期不存在', expiresOn: null };
  }
  const today = currentShanghaiDate(now);
  if (raw < today) {
    return { error: '有效期不能早于今天', expiresOn: null };
  }
  const [year, month, day] = today.split('-').map(Number);
  const maxDay = new Date(Date.UTC(year, month - 1, day + MAX_SHARE_EXPIRY_DAYS))
    .toISOString()
    .slice(0, 10);
  if (raw > maxDay) {
    return { error: `自定义有效期最长 ${MAX_SHARE_EXPIRY_DAYS} 天`, expiresOn: null };
  }
  return { expiresOn: raw };
}

/** 有效期末日（'YYYY-MM-DD'）→ 过期时刻 = 当天 24:00（即次日 00:00 上海，UTC 前一日 16:00） */
export function shareExpiryInstant(expiresOn: string): Date {
  const [year, month, day] = expiresOn.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000);
}

/** 解析 YYYY-MM-DD 为 UTC 日历日（不含时区偏移），日期不存在时返回 null */
function parseIsoCalendarDate(value: string): { time: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC 对越界日/月自动进位，用「分量重建后逐项比对」识别不存在的日期
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { time: date.getTime() };
}
