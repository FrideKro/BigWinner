// 统计聚合公共纯函数：/api/stats 与免登录分享接口 /api/s/[code] 共用，保证口径一致
// 数值列一律以 ::text 传输（防 JS number 精度丢失），在此统一转回整数

export interface LeaderboardSqlRow {
  user_id: number;
  nickname: string;
  avatar_color: string;
  is_active: boolean;
  games_played: string;
  net_amount: string;
  win_count: string;
  draw_count: string;
  loss_count: string;
  big_winner_count: string;
  max_win: string;
  max_loss: string;
}

export interface LeaderboardItem {
  rank: number;
  userId: number;
  nickname: string;
  avatarColor: string;
  isActive: boolean;
  gamesPlayed: number;
  netAmount: number;
  winCount: number;
  drawCount: number;
  lossCount: number;
  winRate: number;
  avgAmount: number;
  bigWinnerCount: number;
  bigWinnerRate: number;
  maxWin: number;
  maxLoss: number;
}

/** 总榜 SQL 行 → 前端榜单条目（排序由 SQL 完成，rank = 行序号） */
export function mapLeaderboardRows(rows: LeaderboardSqlRow[]): LeaderboardItem[] {
  return rows.map((row, index) => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const netAmount = parseInt(row.net_amount, 10);
    const winCount = parseInt(row.win_count, 10);
    const drawCount = parseInt(row.draw_count, 10);
    const lossCount = parseInt(row.loss_count, 10);
    const bigWinnerCount = parseInt(row.big_winner_count, 10);

    return {
      rank: index + 1,
      userId: row.user_id,
      nickname: row.nickname,
      avatarColor: row.avatar_color,
      isActive: row.is_active,
      gamesPlayed,
      netAmount,
      winCount,
      drawCount,
      lossCount,
      winRate: gamesPlayed > 0 ? Math.round((winCount / gamesPlayed) * 1000) / 10 : 0,
      avgAmount: gamesPlayed > 0 ? Math.round(netAmount / gamesPlayed) : 0,
      bigWinnerCount,
      bigWinnerRate: gamesPlayed > 0 ? Math.round((bigWinnerCount / gamesPlayed) * 1000) / 10 : 0,
      maxWin: parseInt(row.max_win, 10),
      maxLoss: parseInt(row.max_loss, 10),
    };
  });
}

export interface PersonalHistorySqlRow {
  game_id: number;
  played_at: string;
  date_label: string;
  amount: number;
  is_big_winner: boolean;
  room_fee: number;
  note: string;
}

export interface TrendDataPoint {
  index: number;
  gameId: number;
  playedAt: string;
  dateLabel: string;
  amount: number;
  cumulativeAmount: number;
  isBigWinner: boolean;
  roomFee: number;
  note: string;
}

export interface StreakSummary {
  type: 'WIN' | 'LOSS' | 'NONE';
  count: number;
}

export interface PersonalTrendResult {
  trend: TrendDataPoint[];
  maxWinRecord: { amount: number; gameId: number; playedAt: string; note: string } | null;
  maxLossRecord: { amount: number; gameId: number; playedAt: string; note: string } | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: StreakSummary;
}

/** 个人场次明细 → 累计盈亏曲线、连胜连败与单场极值（按 played_at ASC 排好的行序处理） */
export function buildPersonalTrend(rows: PersonalHistorySqlRow[]): PersonalTrendResult {
  const trend: TrendDataPoint[] = [];
  let maxWinRecord: PersonalTrendResult['maxWinRecord'] = null;
  let maxLossRecord: PersonalTrendResult['maxLossRecord'] = null;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let tempWinStreak = 0;
  let tempLossStreak = 0;

  for (const [idx, r] of rows.entries()) {
    if (r.amount > 0) {
      tempWinStreak += 1;
      tempLossStreak = 0;
      if (tempWinStreak > longestWinStreak) {
        longestWinStreak = tempWinStreak;
      }
      if (!maxWinRecord || r.amount > maxWinRecord.amount) {
        maxWinRecord = {
          amount: r.amount,
          gameId: r.game_id,
          playedAt: r.played_at,
          note: r.note || '',
        };
      }
    } else if (r.amount < 0) {
      tempLossStreak += 1;
      tempWinStreak = 0;
      if (tempLossStreak > longestLossStreak) {
        longestLossStreak = tempLossStreak;
      }
      if (!maxLossRecord || r.amount < maxLossRecord.amount) {
        maxLossRecord = {
          amount: r.amount,
          gameId: r.game_id,
          playedAt: r.played_at,
          note: r.note || '',
        };
      }
    } else {
      tempWinStreak = 0;
      tempLossStreak = 0;
    }

    trend.push({
      index: idx + 1,
      gameId: r.game_id,
      playedAt: r.played_at,
      dateLabel: r.date_label,
      amount: r.amount,
      cumulativeAmount: 0,
      isBigWinner: r.is_big_winner,
      roomFee: r.room_fee,
      note: r.note || '',
    });
  }

  // 按场次顺序补齐累计盈亏
  let cumulative = 0;
  for (const point of trend) {
    cumulative += point.amount;
    point.cumulativeAmount = cumulative;
  }

  let currentStreak: StreakSummary = { type: 'NONE', count: 0 };
  if (tempWinStreak > 0) {
    currentStreak = { type: 'WIN', count: tempWinStreak };
  } else if (tempLossStreak > 0) {
    currentStreak = { type: 'LOSS', count: tempLossStreak };
  }

  return {
    trend,
    maxWinRecord,
    maxLossRecord,
    longestWinStreak,
    longestLossStreak,
    currentStreak,
  };
}

/** 从总榜中取指定玩家的汇总；不在榜（如停用玩家）时给安全默认值 */
export function pickPlayerSummary(leaderboard: LeaderboardItem[], userId: number): LeaderboardItem {
  return (
    leaderboard.find((p) => p.userId === userId) || {
      rank: 0,
      userId,
      nickname: '未知玩家',
      avatarColor: 'red',
      isActive: true,
      gamesPlayed: 0,
      netAmount: 0,
      winCount: 0,
      drawCount: 0,
      lossCount: 0,
      winRate: 0,
      avgAmount: 0,
      bigWinnerCount: 0,
      bigWinnerRate: 0,
      maxWin: 0,
      maxLoss: 0,
    }
  );
}
