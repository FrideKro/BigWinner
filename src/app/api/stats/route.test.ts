// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

import { GET } from './route';

const adminUser = {
  id: 1,
  username: 'admin',
  nickname: '管理员',
  role: 'ADMIN' as const,
  avatarColor: 'amber',
  isActive: true,
  bindToken: 'bind-token',
  deviceToken: 't'.repeat(64),
};

function callGet(query = '') {
  const req = new NextRequest(`http://localhost/api/stats${query}`);
  return GET(req, { params: Promise.resolve({}) });
}

// 期望响应形状的最小数据：各聚合查询返回空/零值
function mockAllQueries() {
  mocks.query.mockImplementation((sql: string) => {
    if (/FROM games\s*$|FROM games\s+WHERE 1=1/.test(sql) && /all_time_games/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            all_time_games: '7',
            all_time_fee: '700',
            year_games: '3',
            year_fee: '300',
            month_games: '2',
            month_fee: '200',
          },
        ],
        rowCount: 1,
      });
    }
    if (/total_games/.test(sql)) {
      // 区间/自定义周期汇总查询（queryPeriodSummary）
      return Promise.resolve({
        rows: [{ total_games: '5', total_room_fee: '50' }],
        rowCount: 1,
      });
    }
    if (/games_played/.test(sql)) {
      // 总榜查询（queryLeaderboard）
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (/games_count/.test(sql)) {
      // 月度房费查询（queryMonthlyFees）
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (/date_label/.test(sql)) {
      // 个人明细查询（queryPersonalHistory）
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (/longest_win_streak/.test(sql)) {
      // 连胜明细查询（queryWinStreaks）
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    throw new Error(`未预期的 SQL: ${sql}`);
  });
}

describe('GET /api/stats', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockAllQueries();
  });

  it('非法 period 参数返回 400（不静默退化为全部数据）', async () => {
    const res = await callGet('?period=abc');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '时间段参数无效' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('from/to 与 period 同时提供返回 400', async () => {
    const res = await callGet('?period=all&from=2025-03-01&to=2025-03-10');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: '时间段参数冲突：不可同时指定 period 与起止日期',
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('显式 period=all 复用全局聚合，不发区间汇总查询', async () => {
    const res = await callGet('?period=all&scope=board');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.period).toBe('all');
    expect(body.summary.totalGames).toBe(7);
    expect(body.summary.totalRoomFee).toBe(700);
    const sqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /total_games/.test(s))).toBe(false);
  });

  it('自定义日期区间按区间汇总，不退化为全时段数字', async () => {
    const res = await callGet('?from=2025-03-01&to=2025-03-10&scope=board');

    expect(res.status).toBe(200);
    const body = await res.json();
    // summary.period 应为 custom，汇总取区间聚合（5 场/50 房费），而非全时段（7 场/700）
    expect(body.summary.period).toBe('custom');
    expect(body.summary.totalGames).toBe(5);
    expect(body.summary.totalRoomFee).toBe(50);
    // 区间边界参数：2025-03-01 00:00+08 ~ 2025-03-11 00:00+08
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('total_games'),
      expect.arrayContaining([
        new Date('2025-02-28T16:00:00.000Z'),
        new Date('2025-03-10T16:00:00.000Z'),
      ]),
    );
  });

  it('scope=board 跳过月度房费与个人明细查询；自定义区间跳过全局三合一查询', async () => {
    await callGet('?period=all&scope=board');

    const sqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /date_label/.test(s))).toBe(false);
    expect(sqls.some((s) => /games_count/.test(s))).toBe(false);

    mocks.query.mockClear();
    await callGet('?from=2025-03-01&to=2025-03-10&scope=board');
    const customSqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(customSqls.some((s) => /all_time_games/.test(s))).toBe(false);
    expect(customSqls.some((s) => /total_games/.test(s))).toBe(true);
  });

  it('scope=personal&onlyPersonal=1 仅查询目标玩家汇总与明细，跳过总榜/连胜/月度房费', async () => {
    const res = await callGet('?period=all&scope=personal&onlyPersonal=1&userId=2');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.personalStats.userId).toBe(2);
    expect(body.achievements).toBeUndefined();
    const sqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /date_label/.test(s))).toBe(true);
    expect(sqls.some((s) => /WHERE u\.id = \$1/.test(s))).toBe(true);
    expect(sqls.some((s) => /longest_win_streak/.test(s))).toBe(false);
    expect(sqls.some((s) => /games_count/.test(s))).toBe(false);
    expect(sqls.some((s) => /all_time_games/.test(s))).toBe(false);
  });

  it('scope=roomFee 仅查询全站房费三卡汇总与月度房费', async () => {
    const res = await callGet('?period=all&scope=roomFee');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.allTimeGames).toBe(7);
    expect(body.monthlyRoomFees).toEqual([]);
    const sqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /all_time_games/.test(s))).toBe(true);
    expect(sqls.some((s) => /games_count/.test(s))).toBe(true);
    expect(sqls.some((s) => /games_played/.test(s))).toBe(false);
    expect(sqls.some((s) => /date_label/.test(s))).toBe(false);
    expect(sqls.some((s) => /longest_win_streak/.test(s))).toBe(false);
  });

  it('scope=full 返回指定玩家的个人统计', async () => {
    const res = await callGet('?period=all&scope=full&userId=2');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.personalStats).toBeDefined();
    expect(body.personalStats.userId).toBe(2);
    expect(body.personalStats.trend).toEqual([]);
    expect(body.achievements).toEqual([
      { type: 'MAX_SINGLE_WIN', holders: [] },
      { type: 'LONGEST_WIN_STREAK', holders: [] },
    ]);
    const sqls = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /date_label/.test(s))).toBe(true);
    expect(sqls.some((s) => /longest_win_streak/.test(s))).toBe(true);
  });

  it('非法 userId 返回 400', async () => {
    const res = await callGet('?period=all&userId=abc');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '无效的玩家 ID' });
  });
});
