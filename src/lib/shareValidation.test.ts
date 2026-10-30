import { describe, expect, it } from 'vitest';
import {
  MAX_SHARE_EXPIRY_DAYS,
  MAX_SHARE_RANGE_DAYS,
  shareExpiryInstant,
  validateShareExpiresOn,
  validateSharePeriodInput,
  validateShareScope,
} from './shareValidation';

describe('validateShareScope', () => {
  it('接受白名单内多选并去重保序', () => {
    expect(validateShareScope(['stats', 'board', 'board'])).toEqual({
      scope: ['stats', 'board'],
    });
  });

  it('拒绝空数组与非数组', () => {
    expect(validateShareScope([]).error).toBeTruthy();
    expect(validateShareScope('board').error).toBeTruthy();
    expect(validateShareScope(undefined).error).toBeTruthy();
  });

  it('拒绝白名单外的选项', () => {
    expect(validateShareScope(['board', 'users']).error).toBeTruthy();
  });
});

describe('validateSharePeriodInput', () => {
  it('接受 all / 具体年份 / 具体月份', () => {
    expect(validateSharePeriodInput({ periodType: 'period', period: 'all' })).toEqual({
      periodType: 'period',
      period: 'all',
      rangeStart: '',
      rangeEnd: '',
    });
    expect(validateSharePeriodInput({ periodType: 'period', period: '2026' }).period).toBe('2026');
    expect(validateSharePeriodInput({ periodType: 'period', period: '2026-10' }).period).toBe(
      '2026-10',
    );
  });

  it('动态周期固化为创建时刻的具体年/月', () => {
    const yearRes = validateSharePeriodInput({ periodType: 'period', period: 'year' });
    expect(yearRes.error).toBeUndefined();
    expect(yearRes.period).toMatch(/^\d{4}$/);
    const monthRes = validateSharePeriodInput({ periodType: 'period', period: 'month' });
    expect(monthRes.error).toBeUndefined();
    expect(monthRes.period).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('拒绝非法月份', () => {
    expect(
      validateSharePeriodInput({ periodType: 'period', period: '2026-13' }).error,
    ).toBeTruthy();
    expect(validateSharePeriodInput({ periodType: 'period', period: 'abc' }).error).toBeTruthy();
  });

  it('接受合法自定义区间', () => {
    const res = validateSharePeriodInput({
      periodType: 'range',
      rangeStart: '2026-10-01',
      rangeEnd: '2026-10-20',
    });
    expect(res.error).toBeUndefined();
    expect(res.rangeStart).toBe('2026-10-01');
    expect(res.rangeEnd).toBe('2026-10-20');
  });

  it('拒绝缺项 / 倒置 / 不存在的日期', () => {
    expect(
      validateSharePeriodInput({ periodType: 'range', rangeStart: '2026-10-01' }).error,
    ).toBeTruthy();
    expect(
      validateSharePeriodInput({
        periodType: 'range',
        rangeStart: '2026-10-20',
        rangeEnd: '2026-10-01',
      }).error,
    ).toBeTruthy();
    expect(
      validateSharePeriodInput({
        periodType: 'range',
        rangeStart: '2026-02-30',
        rangeEnd: '2026-03-01',
      }).error,
    ).toBeTruthy();
  });

  it(`拒绝超过 ${MAX_SHARE_RANGE_DAYS} 天的区间`, () => {
    expect(
      validateSharePeriodInput({
        periodType: 'range',
        rangeStart: '2025-01-01',
        rangeEnd: '2026-01-02',
      }).error,
    ).toBeTruthy();
    expect(
      validateSharePeriodInput({
        periodType: 'range',
        rangeStart: '2025-01-01',
        rangeEnd: '2026-01-01',
      }).error,
    ).toBeUndefined();
  });

  it('拒绝未知的时间段类型', () => {
    expect(validateSharePeriodInput({ periodType: 'week' }).error).toBeTruthy();
  });
});

describe('validateShareExpiresOn', () => {
  const now = new Date('2026-10-31T10:00:00Z'); // 上海 2026-10-31 18:00

  it('今天与未来某日有效（含当天，至当天 24:00）', () => {
    expect(validateShareExpiresOn('2026-10-31', now)).toEqual({ expiresOn: '2026-10-31' });
    expect(validateShareExpiresOn('2026-11-30', now)).toEqual({ expiresOn: '2026-11-30' });
  });

  it('null / undefined / never 表示永久', () => {
    expect(validateShareExpiresOn(null, now)).toEqual({ expiresOn: null });
    expect(validateShareExpiresOn(undefined, now)).toEqual({ expiresOn: null });
    expect(validateShareExpiresOn('never', now)).toEqual({ expiresOn: null });
  });

  it('拒绝过去日期 / 不存在日期 / 非法格式 / 非字符串', () => {
    expect(validateShareExpiresOn('2026-10-30', now).error).toBeTruthy();
    expect(validateShareExpiresOn('2026-02-30', now).error).toBeTruthy();
    expect(validateShareExpiresOn('2026-13-01', now).error).toBeTruthy();
    expect(validateShareExpiresOn('abc', now).error).toBeTruthy();
    expect(validateShareExpiresOn(7, now).error).toBeTruthy();
  });

  it(`拒绝超过 ${MAX_SHARE_EXPIRY_DAYS} 天的自定义有效期`, () => {
    // 今天（10-31）+ 365 = 2027-10-31 允许；+366 拒绝
    expect(validateShareExpiresOn('2027-10-31', now).error).toBeUndefined();
    expect(validateShareExpiresOn('2027-11-01', now).error).toBeTruthy();
  });
});

describe('shareExpiryInstant（过期时刻为当天 24:00）', () => {
  it('当天 24:00（上海）= UTC 当日 16:00', () => {
    expect(shareExpiryInstant('2026-10-31')).toEqual(new Date('2026-10-31T16:00:00.000Z'));
  });

  it('跨月跨年自动进位', () => {
    expect(shareExpiryInstant('2026-12-31')).toEqual(new Date('2026-12-31T16:00:00.000Z'));
    expect(shareExpiryInstant('2027-01-01')).toEqual(new Date('2027-01-01T16:00:00.000Z'));
  });
});
