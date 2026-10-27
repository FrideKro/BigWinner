import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPeriodFilter, validateAndComputeRecords } from './gameLogic';

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
});

describe('buildPeriodFilter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('all / 空 / 非法周期返回空子句', () => {
    for (const period of ['all', '', 'abc', '2025-1', '25', '2025-01-01']) {
      const result = buildPeriodFilter(period, 1);
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    }
  });

  it('指定年份 YYYY 直接透传为参数', () => {
    const result = buildPeriodFilter('2025', 3);

    expect(result.params).toEqual(['2025']);
    expect(result.clause).toContain('$3');
    expect(result.clause).toContain("TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY')");
  });

  it('指定月份 YYYY-MM 直接透传为参数', () => {
    const result = buildPeriodFilter('2025-03', 2);

    expect(result.params).toEqual(['2025-03']);
    expect(result.clause).toContain('$2');
  });

  it('year 分支取上海时区当前年份（含跨年边界）', () => {
    // UTC 2026-12-31 17:30 → 上海时间已是 2027-01-01 01:30
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T17:30:00Z'));

    const result = buildPeriodFilter('year', 1);

    expect(result.params).toEqual(['2027']);
  });

  it('month 分支取上海时区当前年月', () => {
    // UTC 2026-01-31 17:00 → 上海时间 2026-02-01 01:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T17:00:00Z'));

    const result = buildPeriodFilter('month', 1);

    expect(result.params).toEqual(['2026-02']);
  });
});
