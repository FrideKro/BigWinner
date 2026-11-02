// @vitest-environment node
// 统计共享查询层：锁定 SQL 形状与参数结构，防止 /api/stats 与分享链路口径意外漂移
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db', () => ({ query: mocks.query }));

import {
  queryLeaderboard,
  queryMonthlyFees,
  queryPersonalHistory,
  queryPeriodSummary,
} from './statsQueries';

const CLAUSE = 'AND g.played_at >= $1 AND g.played_at < $2';
const PARAMS = [new Date(0), new Date(1)];

describe('statsQueries 共享统计查询', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('queryLeaderboard 透传 clause 与参数，SQL 含总榜排序口径', async () => {
    await queryLeaderboard(CLAUSE, PARAMS);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toBe(PARAMS);
    expect(sql).toContain('WHERE 1=1 AND g.played_at >= $1');
    expect(sql).toContain('u.is_active = TRUE OR gr.id IS NOT NULL');
    expect(sql).toContain('ORDER BY (COUNT(gr.id) > 0) DESC');
  });

  it('queryPeriodSummary 透传 clause 与参数', async () => {
    await queryPeriodSummary(CLAUSE, PARAMS);

    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toBe(PARAMS);
    expect(sql).toContain('SUM(g.room_fee)');
    expect(sql).toContain('WHERE 1=1 AND g.played_at >= $1');
  });

  it('queryMonthlyFees 不传 limit 时不带 LIMIT，走全量月份', async () => {
    await queryMonthlyFees(CLAUSE, PARAMS);

    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toBe(PARAMS);
    expect(sql).not.toMatch(/LIMIT/i);
    expect(sql).toContain("TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')");
  });

  it('queryMonthlyFees 传 limit 时以占位符追加在参数末尾', async () => {
    await queryMonthlyFees('', [], 36);

    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual([36]);
    expect(sql).toContain('LIMIT $1');
  });

  it('queryPersonalHistory 把 userId 追加为末位参数并按时间正序', async () => {
    await queryPersonalHistory(CLAUSE, PARAMS, 7);

    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual([...PARAMS, 7]);
    expect(sql).toContain('WHERE gr.user_id = $3');
    expect(sql).toContain('ORDER BY g.played_at ASC, g.id ASC');
  });
});
