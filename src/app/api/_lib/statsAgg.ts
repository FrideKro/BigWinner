// 统计聚合公共纯函数：/api/stats 与免登录分享接口 /api/s/[code] 共用，保证口径一致
// 数值列一律以 ::text 传输（防 JS number 精度丢失），在此统一转回整数
import { TEMP_PLAYER_ROLE, type UserRole } from '@/lib/roles';

export interface LeaderboardSqlRow {
  user_id: number;
  nickname: string;
  avatar_color: string;
  is_active: boolean;
  role: UserRole;
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
  role: UserRole;
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
      role: row.role,
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

/**
 * 过滤总榜中的临时玩家（不进排行榜）并重编 rank，保持其余相对次序不变。
 * 临时玩家仍参与记账/流水/房费配平，仅榜单与成就推导不展示；
 * 过滤必须发生在 deriveAchievements 之前，避免临时玩家霸占全群成就
 */
export function excludeTempPlayers(leaderboard: LeaderboardItem[]): LeaderboardItem[] {
  return leaderboard
    .filter((p) => p.role !== TEMP_PLAYER_ROLE)
    .map((p, index) => ({ ...p, rank: index + 1 }));
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

/** 指定玩家最长连胜 SQL 行（queryWinStreaks 返回；只含有胜局的用户） */
export interface WinStreakSqlRow {
  user_id: number;
  longest_win_streak: string;
}

export type AchievementType = 'MAX_SINGLE_WIN' | 'LONGEST_WIN_STREAK';

/** 成就展示元信息：名称与图标，UI 直接复用 */
export const ACHIEVEMENT_META: Record<AchievementType, { name: string; icon: string }> = {
  MAX_SINGLE_WIN: { name: '单场最高', icon: '🎯' },
  LONGEST_WIN_STREAK: { name: '连胜场次', icon: '🔥' },
};

export interface AchievementHolder {
  userId: number;
  nickname: string;
  avatarColor: string;
  value: number;
}

export interface Achievement {
  type: AchievementType;
  holders: AchievementHolder[];
}

/**
 * 全群成就推导：单场最高赢分与最长连胜的全群纪录保持者（随所选时间段实时变化）。
 * 取全群最大值，并列者全部入列且保持榜单 rank 序；无可颁纪录（无胜局/连胜）时 holders 为空。
 * 单场最高直接复用总榜已算的 maxWin，连胜取 queryWinStreaks 结果（不在榜用户按 0 兜底）
 */
export function deriveAchievements(
  leaderboard: LeaderboardItem[],
  streakRows: WinStreakSqlRow[],
): Achievement[] {
  const streakMap = new Map<number, number>();
  for (const row of streakRows) {
    streakMap.set(row.user_id, parseInt(row.longest_win_streak, 10) || 0);
  }

  const maxWin = Math.max(0, ...leaderboard.map((p) => p.maxWin));
  const maxStreak = Math.max(0, ...streakMap.values());

  const toHolder = (p: LeaderboardItem, value: number): AchievementHolder => ({
    userId: p.userId,
    nickname: p.nickname,
    avatarColor: p.avatarColor,
    value,
  });

  return [
    {
      type: 'MAX_SINGLE_WIN',
      holders:
        maxWin > 0
          ? leaderboard.filter((p) => p.maxWin === maxWin).map((p) => toHolder(p, maxWin))
          : [],
    },
    {
      type: 'LONGEST_WIN_STREAK',
      holders:
        maxStreak > 0
          ? leaderboard
              .filter((p) => (streakMap.get(p.userId) ?? 0) === maxStreak)
              .map((p) => toHolder(p, maxStreak))
          : [],
    },
  ];
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
      role: 'PLAYER',
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
