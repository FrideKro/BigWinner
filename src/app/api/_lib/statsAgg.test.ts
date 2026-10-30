import { describe, expect, it } from 'vitest';
import {
  buildPersonalTrend,
  mapLeaderboardRows,
  pickPlayerSummary,
  type LeaderboardSqlRow,
  type PersonalHistorySqlRow,
} from './statsAgg';

function leaderboardRow(overrides: Partial<LeaderboardSqlRow> = {}): LeaderboardSqlRow {
  return {
    user_id: 1,
    nickname: '玩家一',
    avatar_color: 'red',
    is_active: true,
    games_played: '10',
    net_amount: '300',
    win_count: '6',
    draw_count: '1',
    loss_count: '3',
    big_winner_count: '2',
    max_win: '150',
    max_loss: '-80',
    ...overrides,
  };
}

describe('mapLeaderboardRows', () => {
  it('文本数值转整数并派生胜率、场均与大赢家率', () => {
    const items = mapLeaderboardRows([leaderboardRow()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      rank: 1,
      userId: 1,
      nickname: '玩家一',
      gamesPlayed: 10,
      netAmount: 300,
      winCount: 6,
      drawCount: 1,
      lossCount: 3,
      winRate: 60,
      avgAmount: 30,
      bigWinnerCount: 2,
      bigWinnerRate: 20,
      maxWin: 150,
      maxLoss: -80,
    });
  });

  it('零出场时各项归零且不产生除零', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({
        games_played: '0',
        net_amount: '0',
        win_count: '0',
        draw_count: '0',
        loss_count: '0',
        big_winner_count: '0',
        max_win: '0',
        max_loss: '0',
      }),
    ]);
    expect(items[0]).toMatchObject({
      gamesPlayed: 0,
      netAmount: 0,
      winRate: 0,
      avgAmount: 0,
      bigWinnerRate: 0,
    });
  });

  it('rank 按行序递增', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({ user_id: 1 }),
      leaderboardRow({ user_id: 2, nickname: '玩家二' }),
    ]);
    expect(items.map((i) => i.rank)).toEqual([1, 2]);
  });
});

describe('buildPersonalTrend', () => {
  function historyRow(overrides: Partial<PersonalHistorySqlRow>): PersonalHistorySqlRow {
    return {
      game_id: 1,
      played_at: '2026-10-01T12:00:00.000Z',
      date_label: '10-01',
      amount: 0,
      is_big_winner: false,
      room_fee: 0,
      note: '',
      ...overrides,
    };
  }

  it('累计盈亏逐场累加', () => {
    const res = buildPersonalTrend([
      historyRow({ game_id: 1, amount: 100, date_label: '10-01' }),
      historyRow({ game_id: 2, amount: -30, date_label: '10-02' }),
      historyRow({ game_id: 3, amount: 10, date_label: '10-03' }),
    ]);
    expect(res.trend.map((t) => t.cumulativeAmount)).toEqual([100, 70, 80]);
    expect(res.trend.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  it('统计最长连胜/连败与当前连击', () => {
    const res = buildPersonalTrend([
      historyRow({ game_id: 1, amount: 10 }),
      historyRow({ game_id: 2, amount: 20 }),
      historyRow({ game_id: 3, amount: -5 }),
      historyRow({ game_id: 4, amount: -6 }),
      historyRow({ game_id: 5, amount: -7 }),
      historyRow({ game_id: 6, amount: 0 }),
    ]);
    expect(res.longestWinStreak).toBe(2);
    expect(res.longestLossStreak).toBe(3);
    // 平局打断连击，当前无连击
    expect(res.currentStreak).toEqual({ type: 'NONE', count: 0 });
  });

  it('当前连击取最后一段', () => {
    const res = buildPersonalTrend([
      historyRow({ game_id: 1, amount: -10 }),
      historyRow({ game_id: 2, amount: 5 }),
      historyRow({ game_id: 3, amount: 6 }),
    ]);
    expect(res.currentStreak).toEqual({ type: 'WIN', count: 2 });
  });

  it('记录单场最大赢/输', () => {
    const res = buildPersonalTrend([
      historyRow({ game_id: 1, amount: 50, note: '首胜' }),
      historyRow({ game_id: 2, amount: 120 }),
      historyRow({ game_id: 3, amount: -90 }),
      historyRow({ game_id: 4, amount: -60 }),
    ]);
    expect(res.maxWinRecord).toMatchObject({ amount: 120, gameId: 2 });
    expect(res.maxLossRecord).toMatchObject({ amount: -90, gameId: 3 });
  });

  it('空明细返回空趋势与 NONE 连击', () => {
    const res = buildPersonalTrend([]);
    expect(res.trend).toEqual([]);
    expect(res.maxWinRecord).toBeNull();
    expect(res.maxLossRecord).toBeNull();
    expect(res.currentStreak).toEqual({ type: 'NONE', count: 0 });
  });
});

describe('pickPlayerSummary', () => {
  it('命中榜单中的玩家', () => {
    const items = mapLeaderboardRows([leaderboardRow({ user_id: 7 })]);
    expect(pickPlayerSummary(items, 7).nickname).toBe('玩家一');
  });

  it('不在榜时返回零值兜底', () => {
    const summary = pickPlayerSummary([], 42);
    expect(summary).toMatchObject({
      rank: 0,
      userId: 42,
      nickname: '未知玩家',
      gamesPlayed: 0,
      netAmount: 0,
    });
  });
});
