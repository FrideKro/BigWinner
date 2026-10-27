import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { buildPeriodFilter } from '@/lib/gameLogic';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'all';
    const targetUserId = searchParams.get('userId')
      ? parseInt(searchParams.get('userId')!, 10)
      : user.id;

    const { clause, params } = buildPeriodFilter(period, 1);

    // 1. 所选周期的场次与房费汇总
    const periodSummaryRes = await query<{
      total_games: string;
      total_room_fee: string;
    }>(
      `SELECT COUNT(*)::text AS total_games,
              COALESCE(SUM(g.room_fee), 0)::text AS total_room_fee
       FROM games g
       WHERE 1=1 ${clause}`,
      params,
    );

    const totalGames = parseInt(periodSummaryRes.rows[0]?.total_games || '0', 10);
    const totalRoomFee = parseInt(periodSummaryRes.rows[0]?.total_room_fee || '0', 10);

    // 2. 全局房费概览（全部、本年、本月）+ 可选月份列表
    const now = new Date();
    const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    });
    const parts = shanghaiFormatter.formatToParts(now);
    const currentYear = parts.find((p) => p.type === 'year')?.value || '2026';
    const currentMonth = `${currentYear}-${parts.find((p) => p.type === 'month')?.value || '01'}`;

    const globalRoomFeeRes = await query<{
      all_time_games: string;
      all_time_fee: string;
      year_games: string;
      year_fee: string;
      month_games: string;
      month_fee: string;
    }>(
      `SELECT
         COUNT(*)::text AS all_time_games,
         COALESCE(SUM(room_fee), 0)::text AS all_time_fee,
         COUNT(*) FILTER (WHERE TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY') = $1)::text AS year_games,
         COALESCE(SUM(room_fee) FILTER (WHERE TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY') = $1), 0)::text AS year_fee,
         COUNT(*) FILTER (WHERE TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = $2)::text AS month_games,
         COALESCE(SUM(room_fee) FILTER (WHERE TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') = $2), 0)::text AS month_fee
       FROM games`,
      [currentYear, currentMonth],
    );

    const gRow = globalRoomFeeRes.rows[0];

    // 3. 月度房费明细统计
    const monthlyFeeRes = await query<{
      month: string;
      games_count: string;
      total_room_fee: string;
    }>(
      `SELECT TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month,
              COUNT(*)::text AS games_count,
              COALESCE(SUM(room_fee), 0)::text AS total_room_fee
       FROM games
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 36`,
    );

    const monthlyRoomFees = monthlyFeeRes.rows.map((m) => {
      const gc = parseInt(m.games_count, 10);
      const tf = parseInt(m.total_room_fee, 10);
      return {
        month: m.month,
        gamesCount: gc,
        totalRoomFee: tf,
        avgRoomFee: gc > 0 ? Math.round(tf / gc) : 0,
      };
    });

    // 4. 玩家总榜（按所选时间周期）
    const leaderboardRes = await query<{
      user_id: number;
      username: string;
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
    }>(
      `SELECT u.id AS user_id,
              u.username,
              u.nickname,
              u.avatar_color,
              u.is_active,
              COUNT(gr.id)::text AS games_played,
              COALESCE(SUM(gr.amount), 0)::text AS net_amount,
              COUNT(gr.id) FILTER (WHERE gr.amount > 0)::text AS win_count,
              COUNT(gr.id) FILTER (WHERE gr.amount = 0)::text AS draw_count,
              COUNT(gr.id) FILTER (WHERE gr.amount < 0)::text AS loss_count,
              COUNT(gr.id) FILTER (WHERE gr.is_big_winner = TRUE)::text AS big_winner_count,
              COALESCE(MAX(gr.amount) FILTER (WHERE gr.amount > 0), 0)::text AS max_win,
              COALESCE(MIN(gr.amount) FILTER (WHERE gr.amount < 0), 0)::text AS max_loss
       FROM users u
       LEFT JOIN (
         SELECT gr_inner.*
         FROM game_records gr_inner
         JOIN games g ON g.id = gr_inner.game_id
         WHERE 1=1 ${clause}
       ) gr ON gr.user_id = u.id
       WHERE u.is_active = TRUE OR gr.id IS NOT NULL
       GROUP BY u.id
       ORDER BY (COUNT(gr.id) > 0) DESC,
                COALESCE(SUM(gr.amount), 0) DESC,
                COUNT(gr.id) FILTER (WHERE gr.is_big_winner = TRUE) DESC,
                COUNT(gr.id) DESC,
                u.id ASC`,
      params,
    );

    const leaderboard = leaderboardRes.rows.map((row, index) => {
      const gamesPlayed = parseInt(row.games_played, 10);
      const netAmount = parseInt(row.net_amount, 10);
      const winCount = parseInt(row.win_count, 10);
      const drawCount = parseInt(row.draw_count, 10);
      const lossCount = parseInt(row.loss_count, 10);
      const bigWinnerCount = parseInt(row.big_winner_count, 10);

      return {
        rank: index + 1,
        userId: row.user_id,
        username: row.username,
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

    // 5. 指定玩家的个人详情、极值、连胜连败与累计盈亏曲线
    const personalParams = [...params, targetUserId];
    const personalHistoryRes = await query<{
      game_id: number;
      played_at: string;
      date_label: string;
      amount: number;
      is_big_winner: boolean;
      room_fee: number;
      note: string;
    }>(
      `SELECT g.id AS game_id,
              g.played_at,
              TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD') AS date_label,
              gr.amount,
              gr.is_big_winner,
              g.room_fee,
              g.note
       FROM game_records gr
       JOIN games g ON g.id = gr.game_id
       WHERE gr.user_id = $${personalParams.length}
         ${clause}
       ORDER BY g.played_at ASC, g.id ASC`,
      personalParams,
    );

    let cumulative = 0;
    let maxWinRecord: {
      amount: number;
      gameId: number;
      playedAt: string;
      note: string;
    } | null = null;
    let maxLossRecord: {
      amount: number;
      gameId: number;
      playedAt: string;
      note: string;
    } | null = null;

    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    const trend = personalHistoryRes.rows.map((r, idx) => {
      cumulative += r.amount;

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

      return {
        index: idx + 1,
        gameId: r.game_id,
        playedAt: r.played_at,
        dateLabel: r.date_label,
        amount: r.amount,
        cumulativeAmount: cumulative,
        isBigWinner: r.is_big_winner,
        roomFee: r.room_fee,
        note: r.note || '',
      };
    });

    let currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number } = {
      type: 'NONE',
      count: 0,
    };
    if (tempWinStreak > 0) {
      currentStreak = { type: 'WIN', count: tempWinStreak };
    } else if (tempLossStreak > 0) {
      currentStreak = { type: 'LOSS', count: tempLossStreak };
    }

    const targetPlayerSummary = leaderboard.find((p) => p.userId === targetUserId) || {
      rank: 0,
      userId: targetUserId,
      username: '',
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
    };

    return NextResponse.json({
      summary: {
        period,
        totalGames,
        totalRoomFee,
        avgRoomFee: totalGames > 0 ? Math.round(totalRoomFee / totalGames) : 0,
        allTimeGames: parseInt(gRow?.all_time_games || '0', 10),
        allTimeRoomFee: parseInt(gRow?.all_time_fee || '0', 10),
        thisYearGames: parseInt(gRow?.year_games || '0', 10),
        thisYearRoomFee: parseInt(gRow?.year_fee || '0', 10),
        thisMonthGames: parseInt(gRow?.month_games || '0', 10),
        thisMonthRoomFee: parseInt(gRow?.month_fee || '0', 10),
        availableMonths: monthlyRoomFees.map((m) => m.month),
      },
      leaderboard,
      monthlyRoomFees,
      personalStats: {
        ...targetPlayerSummary,
        maxWinRecord,
        maxLossRecord,
        currentStreak,
        longestWinStreak,
        longestLossStreak,
        trend,
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json({ error: '获取统计数据失败' }, { status: 500 });
  }
}
