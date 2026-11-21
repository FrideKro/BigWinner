import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_META,
  buildPersonalTrend,
  deriveAchievements,
  excludeTempPlayers,
  mapLeaderboardRows,
  pickPlayerSummary,
  type LeaderboardSqlRow,
  type PersonalHistorySqlRow,
  type AchievementType,
  type WinStreakSqlRow,
} from './statsAgg';

function leaderboardRow(overrides: Partial<LeaderboardSqlRow> = {}): LeaderboardSqlRow {
  return {
    user_id: 1,
    nickname: '玩家一',
    avatar_color: 'red',
    is_active: true,
    role: 'PLAYER',
    games_played: '10',
    net_amount: '300',
    win_count: '7',
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
      winCount: 7,
      drawCount: 1,
      lossCount: 3,
      winRate: 70,
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

describe('excludeTempPlayers', () => {
  it('剔除临时玩家并对其余玩家重编 rank，保持相对次序', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, nickname: '甲' }),
      leaderboardRow({ user_id: 2, nickname: '临时甲', role: 'TEMP_PLAYER' }),
      leaderboardRow({ user_id: 3, nickname: '乙' }),
      leaderboardRow({ user_id: 4, nickname: '临时乙', role: 'TEMP_PLAYER' }),
      leaderboardRow({ user_id: 5, nickname: '丙' }),
    ]);
    const filtered = excludeTempPlayers(items);
    expect(filtered.map((p) => p.nickname)).toEqual(['甲', '乙', '丙']);
    expect(filtered.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('无临时玩家时原样保留（rank 重编后不变）', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({ user_id: 1 }),
      leaderboardRow({ user_id: 2, nickname: '玩家二' }),
    ]);
    expect(excludeTempPlayers(items)).toEqual(items);
  });

  it('全为临时玩家时返回空数组', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, role: 'TEMP_PLAYER' }),
      leaderboardRow({ user_id: 2, nickname: '玩家二', role: 'TEMP_PLAYER' }),
    ]);
    expect(excludeTempPlayers(items)).toEqual([]);
  });

  it('过滤临时玩家后不再参与全群成就推导', () => {
    const items = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, nickname: '普通玩家', max_win: '50' }),
      leaderboardRow({ user_id: 2, nickname: '临时大佬', role: 'TEMP_PLAYER', max_win: '999' }),
    ]);
    const achievements = deriveAchievements(excludeTempPlayers(items), []);
    const maxWinHolders = achievements.find((a) => a.type === 'MAX_SINGLE_WIN')?.holders ?? [];
    expect(maxWinHolders.map((h) => h.nickname)).toEqual(['普通玩家']);
    expect(maxWinHolders[0].value).toBe(50);
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

describe('deriveAchievements', () => {
  function streakRow(overrides: Partial<WinStreakSqlRow> = {}): WinStreakSqlRow {
    return { user_id: 1, longest_win_streak: '2', ...overrides };
  }

  const holdersOf = (achievements: ReturnType<typeof deriveAchievements>, type: AchievementType) =>
    achievements.find((a) => a.type === type)?.holders ?? [];

  it('唯一持有者拿到单场最高与连胜成就', () => {
    const leaderboard = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, nickname: '玩家一', max_win: '150' }),
      leaderboardRow({ user_id: 2, nickname: '玩家二', max_win: '80' }),
    ]);
    const achievements = deriveAchievements(leaderboard, [
      streakRow({ user_id: 2, longest_win_streak: '3' }),
      streakRow({ user_id: 1, longest_win_streak: '1' }),
    ]);
    expect(holdersOf(achievements, 'MAX_SINGLE_WIN')).toEqual([
      { userId: 1, nickname: '玩家一', avatarColor: 'red', value: 150 },
    ]);
    expect(holdersOf(achievements, 'LONGEST_WIN_STREAK')).toEqual([
      { userId: 2, nickname: '玩家二', avatarColor: 'red', value: 3 },
    ]);
  });

  it('并列纪录者全部入列且保持榜单 rank 序', () => {
    const leaderboard = mapLeaderboardRows([
      leaderboardRow({ user_id: 2, nickname: '玩家二', max_win: '120' }),
      leaderboardRow({ user_id: 1, nickname: '玩家一', max_win: '120' }),
    ]);
    const maxWin = holdersOf(
      deriveAchievements(leaderboard, [streakRow({ user_id: 2 })]),
      'MAX_SINGLE_WIN',
    );
    expect(maxWin.map((h) => h.userId)).toEqual([2, 1]);
    expect(maxWin.every((h) => h.value === 120)).toBe(true);
  });

  it('无可颁纪录（无胜局、无连胜）时 holders 为空', () => {
    const leaderboard = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, max_win: '0' }),
      leaderboardRow({ user_id: 2, max_win: '0' }),
    ]);
    const achievements = deriveAchievements(leaderboard, []);
    expect(holdersOf(achievements, 'MAX_SINGLE_WIN')).toEqual([]);
    expect(holdersOf(achievements, 'LONGEST_WIN_STREAK')).toEqual([]);
  });

  it('连胜 SQL 行缺失的用户按 0 兜底，不误颁成就', () => {
    const leaderboard = mapLeaderboardRows([
      leaderboardRow({ user_id: 1, max_win: '50' }),
      leaderboardRow({ user_id: 2, max_win: '30' }),
    ]);
    const streak = holdersOf(
      deriveAchievements(leaderboard, [streakRow({ user_id: 1, longest_win_streak: '0' })]),
      'LONGEST_WIN_STREAK',
    );
    expect(streak).toEqual([]);
  });

  it('临时玩家的连胜不把全群纪录顶成虚位以待（streak 行不过滤，最大值以过滤后榜单为准）', () => {
    // 路由实际传参口径：榜单已过滤临时玩家，streakRows 含临时玩家（queryWinStreaks 不分角色）
    const leaderboard = mapLeaderboardRows([leaderboardRow({ user_id: 1, nickname: '普通玩家' })]);
    const streak = holdersOf(
      deriveAchievements(leaderboard, [
        streakRow({ user_id: 1, longest_win_streak: '3' }),
        streakRow({ user_id: 2, longest_win_streak: '5' }), // 临时玩家持有更高连胜
      ]),
      'LONGEST_WIN_STREAK',
    );
    expect(streak).toEqual([{ userId: 1, nickname: '普通玩家', avatarColor: 'red', value: 3 }]);
  });

  it('成就元信息含名称与图标', () => {
    expect(ACHIEVEMENT_META.MAX_SINGLE_WIN.name).toBe('单场最高');
    expect(ACHIEVEMENT_META.LONGEST_WIN_STREAK.name).toBe('最长连胜');
    expect(ACHIEVEMENT_META.MAX_SINGLE_WIN.icon).toBeTruthy();
    expect(ACHIEVEMENT_META.LONGEST_WIN_STREAK.icon).toBeTruthy();
  });
});
