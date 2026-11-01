import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPeriodFilter,
  buildTimeFilter,
  isValidPeriod,
  validateAndComputeRecords,
  validatePlayedAt,
} from './gameLogic';

describe('validateAndComputeRecords', () => {
  it('正常配平：返回各玩家金额并标记唯一大赢家', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 300 },
        { userId: 2, amount: -200 },
        { userId: 3, amount: -50 },
        { userId: 4, amount: -50 },
      ],
      0,
    );

    expect(result.error).toBeUndefined();
    expect(result.roomFee).toBe(0);
    expect(result.records).toHaveLength(4);
    expect(result.records.find((r) => r.userId === 1)?.isBigWinner).toBe(true);
    expect(result.records.filter((r) => r.isBigWinner)).toHaveLength(1);
  });

  it('房费参与配平：玩家合计 + 房费 = 0', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 200 },
        { userId: 2, amount: -100 },
        { userId: 3, amount: -150 },
      ],
      50,
    );

    expect(result.error).toBeUndefined();
    expect(result.roomFee).toBe(50);
  });

  it('拒绝负数房费', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 2, amount: -100 },
      ],
      -10,
    );

    expect(result.error).toBe('本场房费必须为大于或等于 0 的整数');
    expect(result.records).toEqual([]);
  });

  it('拒绝非整数房费', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 2, amount: -100 },
      ],
      10.5,
    );

    expect(result.error).toBe('本场房费必须为大于或等于 0 的整数');
  });

  it('拒绝少于 2 名玩家', () => {
    const result = validateAndComputeRecords([{ userId: 1, amount: 0 }], 0);

    expect(result.error).toBe('每场至少需要选择 2 名参与玩家');
  });

  it('拒绝超过 50 名玩家', () => {
    const records = Array.from({ length: 51 }, (_, idx) => ({
      userId: idx + 1,
      amount: 0,
    }));
    const result = validateAndComputeRecords(records, 0);

    expect(result.error).toBe('每场最多支持 50 名参与玩家');
    expect(result.records).toEqual([]);
  });

  it('拒绝非整数金额', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100.5 },
        { userId: 2, amount: -100.5 },
      ],
      0,
    );

    expect(result.error).toBe('所有玩家的输赢金额必须为整数');
  });

  it('拒绝同一场次重复选择同一名玩家', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 1, amount: -100 },
      ],
      0,
    );

    expect(result.error).toBe('同一场次不能重复选择同一名玩家');
  });

  it('拒绝无效玩家 ID', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 0, amount: 100 },
        { userId: 2, amount: -100 },
      ],
      0,
    );

    expect(result.error).toBe('存在无效的玩家 ID');
  });

  it('未配平时返回错误并说明合计', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 2, amount: -50 },
      ],
      0,
    );

    expect(result.error).toContain('账目未配平');
    expect(result.error).toContain('+50');
    expect(result.records).toEqual([]);
  });

  it('大赢家允许多人并列', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 2, amount: 100 },
        { userId: 3, amount: -150 },
        { userId: 4, amount: -50 },
      ],
      0,
    );

    expect(result.error).toBeUndefined();
    expect(result.records.filter((r) => r.isBigWinner).map((r) => r.userId)).toEqual([1, 2]);
  });

  it('全员非正分时无人是大赢家', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 0 },
        { userId: 2, amount: 0 },
      ],
      0,
    );

    expect(result.error).toBeUndefined();
    expect(result.records.every((r) => !r.isBigWinner)).toBe(true);
  });

  it('拒绝超过系统上限的房费', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 100 },
        { userId: 2, amount: -100 },
      ],
      2147483648,
    );

    expect(result.error).toBe('本场房费超出系统上限（不超过 2147483647）');
  });

  it('拒绝正向金额超出系统上限', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 2147483648 },
        { userId: 2, amount: -2147483648 },
      ],
      0,
    );

    expect(result.error).toBe('单笔输赢金额超出系统上限（绝对值不超过 2147483647）');
  });

  it('拒绝负向金额低于系统下限', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: -2147483648 },
        { userId: 2, amount: 2147483648 },
      ],
      0,
    );

    expect(result.error).toBe('单笔输赢金额超出系统上限（绝对值不超过 2147483647）');
  });

  it('恰好等于上限的金额可配平通过', () => {
    const result = validateAndComputeRecords(
      [
        { userId: 1, amount: 2147483647 },
        { userId: 2, amount: -2147483647 },
      ],
      0,
    );

    expect(result.error).toBeUndefined();
  });
});

describe('buildPeriodFilter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('all / 空 / 非法周期返回空子句', () => {
    // 越界月份（00/13/99）不得被 Date.UTC 静默滚动到相邻周期，必须与非法值同样不过滤
    for (const period of [
      'all',
      '',
      'abc',
      '2025-1',
      '25',
      '2025-01-01',
      '2026-00',
      '2026-13',
      '2026-99',
    ]) {
      const result = buildPeriodFilter(period, 1);
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    }
  });

  it('指定年份返回上海时区当年的 UTC 范围条件（sargable）', () => {
    const result = buildPeriodFilter('2025', 3);

    expect(result.clause).toContain('g.played_at >= $3');
    expect(result.clause).toContain('g.played_at < $4');
    // 2025-01-01 00:00+08 ~ 2026-01-01 00:00+08
    expect(result.params).toEqual([
      new Date('2024-12-31T16:00:00.000Z'),
      new Date('2025-12-31T16:00:00.000Z'),
    ]);
  });

  it('指定月份返回上海时区当月的 UTC 范围条件', () => {
    const result = buildPeriodFilter('2025-03', 2);

    expect(result.clause).toContain('g.played_at >= $2');
    expect(result.clause).toContain('g.played_at < $3');
    // 2025-03-01 00:00+08 ~ 2025-04-01 00:00+08
    expect(result.params).toEqual([
      new Date('2025-02-28T16:00:00.000Z'),
      new Date('2025-03-31T16:00:00.000Z'),
    ]);
  });

  it('year 分支取上海时区当前年份（含跨年边界）', () => {
    // UTC 2026-12-31 17:30 → 上海时间已是 2027-01-01 01:30
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T17:30:00Z'));

    const result = buildPeriodFilter('year', 1);

    expect(result.params).toEqual([
      new Date('2026-12-31T16:00:00.000Z'),
      new Date('2027-12-31T16:00:00.000Z'),
    ]);
  });

  it('month 分支取上海时区当前年月', () => {
    // UTC 2026-01-31 17:00 → 上海时间 2026-02-01 01:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T17:00:00Z'));

    const result = buildPeriodFilter('month', 1);

    // 2026-02 只有 28 天
    expect(result.params).toEqual([
      new Date('2026-01-31T16:00:00.000Z'),
      new Date('2026-02-28T16:00:00.000Z'),
    ]);
  });
});

describe('isValidPeriod', () => {
  it('接受 all / year / month / YYYY / YYYY-MM', () => {
    for (const p of ['all', 'year', 'month', '2025', '2025-03']) {
      expect(isValidPeriod(p)).toBe(true);
    }
  });

  it('拒绝非法周期参数（避免静默退化为全部数据）', () => {
    for (const p of ['', 'abc', '202-3', '2025-13', '2025-00', '2025年', 'all ', 'YYYY-MM']) {
      expect(isValidPeriod(p)).toBe(false);
    }
  });
});

describe('buildTimeFilter', () => {
  it('无 from/to 时按 period 走 buildPeriodFilter（含缺省 all）', () => {
    const explicit = buildTimeFilter('2025-03', null, null);
    expect(explicit.error).toBe('');
    expect(explicit.clause).toContain('g.played_at >= $1');

    const fallback = buildTimeFilter(null, null, null);
    expect(fallback.error).toBe('');
    expect(fallback.clause).toBe('');
    expect(fallback.params).toEqual([]);
  });

  it('非法 period 返回错误（不静默退化为全部数据）', () => {
    const result = buildTimeFilter('abc', null, null);
    expect(result.error).toBe('时间段参数无效');
  });

  it('自定义区间返回上海时区自然日 UTC 边界（含结束当天）', () => {
    const result = buildTimeFilter(null, '2025-03-01', '2025-03-10');

    expect(result.error).toBe('');
    expect(result.clause).toContain('g.played_at >= $1');
    expect(result.clause).toContain('g.played_at < $2');
    // 2025-03-01 00:00+08 ~ 2025-03-11 00:00+08
    expect(result.params).toEqual([
      new Date('2025-02-28T16:00:00.000Z'),
      new Date('2025-03-10T16:00:00.000Z'),
    ]);
  });

  it('from 与 period 同时提供返回冲突错误', () => {
    const result = buildTimeFilter('2025', '2025-03-01', '2025-03-10');
    expect(result.error).toBe('时间段参数冲突：不可同时指定 period 与起止日期');
  });

  it('只提供 from 或 to 一端返回错误', () => {
    expect(buildTimeFilter(null, '2025-03-01', null).error).toBe(
      '自定义时间段需要同时提供开始与结束日期',
    );
    expect(buildTimeFilter(null, null, '2025-03-10').error).toBe(
      '自定义时间段需要同时提供开始与结束日期',
    );
  });

  it('日期非法（格式错误、不存在的日期、end 早于 start）返回错误', () => {
    for (const [from, to] of [
      ['2025-3-1', '2025-03-10'],
      ['2025-02-30', '2025-03-10'],
      ['2025-03-10', '2025-03-01'],
    ]) {
      const result = buildTimeFilter(null, from, to);
      expect(result.error).toBe('自定义时间段日期无效');
    }
  });

  it('from 或 to 为空字符串视同缺失一端', () => {
    expect(buildTimeFilter(null, '', '2025-03-10').error).toBe(
      '自定义时间段需要同时提供开始与结束日期',
    );
    expect(buildTimeFilter(null, '2025-03-01', '').error).toBe(
      '自定义时间段需要同时提供开始与结束日期',
    );
  });
});

describe('validatePlayedAt', () => {
  it('接受 2000 ~ 2100 年（上海时区）内的时间', () => {
    expect(validatePlayedAt(new Date('2000-01-01T00:00:00+08:00'))).toBeNull();
    expect(validatePlayedAt(new Date('2026-10-31T14:00:00+08:00'))).toBeNull();
    expect(validatePlayedAt(new Date('2099-12-31T23:59:59+08:00'))).toBeNull();
  });

  it('拒绝区间外的远古/远期时间', () => {
    expect(validatePlayedAt(new Date('1999-12-31T23:59:59+08:00'))).not.toBeNull();
    expect(validatePlayedAt(new Date('2100-01-01T00:00:00+08:00'))).not.toBeNull();
    expect(validatePlayedAt(new Date('1899-01-01T00:00:00Z'))).not.toBeNull();
  });
});
