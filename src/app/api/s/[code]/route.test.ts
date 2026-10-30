// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getClientIp: vi.fn(),
  checkRateLimit: vi.fn(),
  getRateLimitState: vi.fn(),
  recordFailure: vi.fn(),
  clearFailures: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('@/lib/rateLimit', () => ({
  getClientIp: mocks.getClientIp,
  checkRateLimit: mocks.checkRateLimit,
  getRateLimitState: mocks.getRateLimitState,
  recordFailure: mocks.recordFailure,
  clearFailures: mocks.clearFailures,
}));

import { GET } from './route';

const CODE = 'a1b2c3d4e5f60718';

const shareRow = {
  id: 1,
  code: CODE,
  content_scope: 'board,games,stats',
  period_type: 'period',
  period: '2026-10',
  range_start: null,
  range_end: null,
  expires_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
};

const lbRow = {
  user_id: 1,
  nickname: '玩家一',
  avatar_color: 'red',
  is_active: true,
  games_played: '2',
  net_amount: '100',
  win_count: '1',
  draw_count: '0',
  loss_count: '1',
  big_winner_count: '1',
  max_win: '120',
  max_loss: '-20',
};

const gameRow = {
  id: 11,
  played_at: '2026-10-05T12:00:00.000Z',
  room_fee: 20,
  note: '',
  created_by: 1,
  creator_nickname: '管理员',
  created_at: '2026-10-05T12:00:00.000Z',
  records: [{ userId: 1, nickname: '玩家一', avatarColor: 'red', amount: 20, isBigWinner: true }],
};

const monthlyRow = { month: '2026-10', games_count: '2', total_room_fee: '50' };

const historyRow = {
  game_id: 11,
  played_at: '2026-10-05T12:00:00.000Z',
  date_label: '10-05',
  amount: 100,
  is_big_winner: true,
  room_fee: 20,
  note: '',
};

// 按表/子句特征分发查询结果（fetchShare → games 分页 → 总榜 → 个人明细 → 月度 → 汇总兜底）
function mockShareQueries(share: Record<string, unknown> | null) {
  mocks.query.mockImplementation((sql: string) => {
    if (sql.includes('FROM share_links')) {
      return Promise.resolve({ rows: share ? [share] : [], rowCount: share ? 1 : 0 });
    }
    if (sql.includes('WITH page_games')) {
      return Promise.resolve({ rows: [gameRow], rowCount: 1 });
    }
    if (sql.includes('FROM users u')) {
      return Promise.resolve({ rows: [lbRow], rowCount: 1 });
    }
    // 个人明细 SQL 同样包含 TO_CHAR，须先于月度分支判断
    if (sql.includes('gr.user_id =')) {
      return Promise.resolve({ rows: [historyRow], rowCount: 1 });
    }
    if (sql.includes('TO_CHAR')) {
      return Promise.resolve({ rows: [monthlyRow], rowCount: 1 });
    }
    return Promise.resolve({ rows: [{ total_games: '2', total_room_fee: '50' }], rowCount: 1 });
  });
}

function getReq(query = '') {
  return new NextRequest(`http://localhost/api/s/${CODE}${query}`);
}

function callGet(query = '') {
  return GET(getReq(query), { params: Promise.resolve({ code: CODE }) });
}

describe('/api/s/[code]', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getClientIp.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.getRateLimitState.mockReset();
    mocks.recordFailure.mockReset();
    mocks.clearFailures.mockReset();
    mocks.getClientIp.mockReturnValue('1.2.3.4');
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getRateLimitState.mockReturnValue({ locked: false, retryAfterSeconds: 0 });
    mockShareQueries(shareRow);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('分享码格式非法直接 404，不落库不计失败', async () => {
    const res = await GET(getReq(), { params: Promise.resolve({ code: '../etc' }) });

    expect(res.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
  });

  it('码不存在 404 并按 IP 记录失败', async () => {
    mockShareQueries(null);

    const res = await callGet();

    expect(res.status).toBe(404);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('share:ip:1.2.3.4', 200);
    expect(mocks.recordFailure).toHaveBeenCalledWith('share:ip:1.2.3.4', 10);
  });

  it('无 x-forwarded-for（直连）时跳过限流计数，防共享桶集体锁定', async () => {
    mocks.getClientIp.mockReturnValue('');
    mockShareQueries(null);

    const res = await callGet();

    expect(res.status).toBe(404);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.getRateLimitState).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalled();
  });

  it('全量请求限速超限返回 429', async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 900 });

    const res = await callGet();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: '访问过于频繁，请约 15 分钟后再试' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('限流锁定期间返回 429', async () => {
    mocks.getRateLimitState.mockReturnValue({ locked: true, retryAfterSeconds: 600 });

    const res = await callGet();

    expect(res.status).toBe(429);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('已过期分享返回 410', async () => {
    mockShareQueries({ ...shareRow, expires_at: new Date(Date.now() - 1000).toISOString() });

    const res = await callGet();

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: '分享链接已过期' });
  });

  it('board 数据：汇总 + 榜单映射 + 分享元信息', async () => {
    const res = await callGet('?tab=board');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as {
      share: { contentScope: string[]; periodLabel: string };
      data: {
        summary: { totalGames: number };
        leaderboard: Array<{ rank: number; winRate: number }>;
      };
    };
    expect(body.share).toMatchObject({
      contentScope: ['board', 'games', 'stats'],
      periodLabel: '2026年10月',
    });
    expect(body.data.summary).toEqual({ totalGames: 2, totalRoomFee: 50, avgRoomFee: 25 });
    expect(body.data.leaderboard[0]).toMatchObject({ rank: 1, userId: 1, winRate: 50 });
  });

  it('分享未包含的内容类型返回 403', async () => {
    mockShareQueries({ ...shareRow, content_scope: 'board' });

    const res = await callGet('?tab=games');

    expect(res.status).toBe(403);
  });

  it('无效 tab 返回 400', async () => {
    const res = await callGet('?tab=users');

    expect(res.status).toBe(400);
  });

  it('games 数据：映射对局卡片', async () => {
    const res = await callGet('?tab=games');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { games: Array<{ id: number; records: Array<{ userId: number }> }>; hasMore: boolean };
    };
    expect(body.data.games).toHaveLength(1);
    expect(body.data.games[0]).toMatchObject({ id: 11, roomFee: 20 });
    expect(body.data.games[0].records[0]).toMatchObject({ userId: 1, amount: 20 });
    expect(body.data.hasMore).toBe(false);
  });

  it('games 分页：超过页大小时裁剪并标记 hasMore', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM share_links')) {
        return Promise.resolve({ rows: [shareRow], rowCount: 1 });
      }
      if (sql.includes('WITH page_games')) {
        return Promise.resolve({ rows: Array.from({ length: 51 }, () => gameRow), rowCount: 51 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await callGet('?tab=games');

    const body = (await res.json()) as { data: { games: unknown[]; hasMore: boolean } };
    expect(body.data.games).toHaveLength(50);
    expect(body.data.hasMore).toBe(true);
  });

  it('games 分页到达 offset 钳位上限后不再标记 hasMore（防重复页死循环）', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM share_links')) {
        return Promise.resolve({ rows: [shareRow], rowCount: 1 });
      }
      if (sql.includes('WITH page_games')) {
        return Promise.resolve({ rows: Array.from({ length: 51 }, () => gameRow), rowCount: 51 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await callGet('?tab=games&offset=2000');

    const body = (await res.json()) as { data: { games: unknown[]; hasMore: boolean } };
    expect(body.data.games).toHaveLength(50);
    expect(body.data.hasMore).toBe(false);
  });

  it('stats 数据：玩家切换列表默认取榜首，个人面板含走势', async () => {
    const res = await callGet('?tab=stats');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        players: Array<{ userId: number; nickname: string }>;
        personalStats: {
          userId: number;
          nickname: string;
          trend: Array<{ cumulativeAmount: number }>;
        };
        monthlyRoomFees: Array<{ month: string; avgRoomFee: number }>;
      };
    };
    expect(body.data.players).toEqual([{ userId: 1, nickname: '玩家一', avatarColor: 'red' }]);
    expect(body.data.personalStats).toMatchObject({ userId: 1, nickname: '玩家一' });
    expect(body.data.personalStats.trend).toHaveLength(1);
    expect(body.data.personalStats.trend[0]).toMatchObject({ cumulativeAmount: 100 });
    expect(body.data.monthlyRoomFees[0]).toMatchObject({ month: '2026-10', avgRoomFee: 25 });
  });

  it('stats 指定玩家按 userId 查询明细', async () => {
    const res = await callGet('?tab=stats&userId=5');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { personalStats: { userId: number } } };
    expect(body.data.personalStats.userId).toBe(5);
  });

  it('自定义区间分享按日期边界过滤', async () => {
    mockShareQueries({
      ...shareRow,
      period_type: 'range',
      range_start: '2026-10-01',
      range_end: '2026-10-20',
    });

    const res = await callGet('?tab=board');

    expect(res.status).toBe(200);
    // fetchShareByCode 是第一次调用，第二次起为业务查询；业务查询参数应为 UTC 起止边界
    const [, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBeInstanceOf(Date);
    const body = (await res.json()) as { share: { periodLabel: string } };
    expect(body.share.periodLabel).toBe('2026-10-01 ~ 2026-10-20');
  });
});
