import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildPeriodFilter, currentShanghaiYearMonth } from '@/lib/gameLogic';
import { withAuth } from '../_lib/handler';

export const GET = withAuth(
  async (req, user) => {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'all';
    const rawUserId = searchParams.get('userId');
    const targetUserId = rawUserId ? parseInt(rawUserId, 10) : user.id;
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    // scope：months=仅月度明细（流水页取月份列表）；board=概览+总榜（首页，省去个人明细查询与大 payload）；
    // full=完整数据（看板页，缺省值），保持向后兼容
    const rawScope = searchParams.get('scope') || '';
    const scope = rawScope === 'board' || rawScope === 'months' ? rawScope : 'full';

    const { clause, params } = buildPeriodFilter(period, 1);

    // 月度明细只依赖全量 games，与周期过滤无关；scope=months 时单独返回
    if (scope === 'months') {
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
      return NextResponse.json({
        summary: { availableMonths: monthlyFeeRes.rows.map((m) => m.month) },
      });
    }

    const { year: currentYear, month: currentMonthPart } = currentShanghaiYearMonth();
    const currentMonth = `${currentYear}-${currentMonthPart}`;

    const personalParams = [...params, targetUserId];

    // 五个查询相互独立，全部并行执行，接口延迟从「五段之和」降为「最慢一段」；
    // scope=board 时不发个人明细查询（第 5 项）
    const [periodSummaryRes, globalRoomFeeRes, monthlyFeeRes, leaderboardRes, personalHistoryRes] =
      await Promise.all([
        query<{ total_games: string; total_room_fee: string }>(
          `SELECT COUNT(*)::text AS total_games,
                  COALESCE(SUM(g.room_fee), 0)::text AS total_room_fee
           FROM games g
           WHERE 1=1 ${clause}`,
          params,
        ),
        query<{
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
        ),
        query<{ month: string; games_count: string; total_room_fee: string }>(
          `SELECT TO_CHAR(played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month,
                  COUNT(*)::text AS games_count,
                  COALESCE(SUM(room_fee), 0)::text AS total_room_fee
           FROM games
           GROUP BY 1
           ORDER BY 1 DESC
           LIMIT 36`,
        ),
        query<{
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
        }>(
          `SELECT u.id AS user_id,
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
        ),
        scope === 'full'
          ? query<{
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
            )
          : Promise.resolve(null),
      ]);

    const totalGames = parseInt(periodSummaryRes.rows[0]?.total_games || '0', 10);
    const totalRoomFee = parseInt(periodSummaryRes.rows[0]?.total_room_fee || '0', 10);

    const gRow = globalRoomFeeRes.rows[0];

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

    // 指定玩家的极值、连胜连败与累计盈亏曲线（仅 scope=full 有数据）
    const trend: Array<{
      index: number;
      gameId: number;
      playedAt: string;
      dateLabel: string;
      amount: number;
      cumulativeAmount: number;
      isBigWinner: boolean;
      roomFee: number;
      note: string;
    }> = [];
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

    for (const [idx, r] of (personalHistoryRes?.rows ?? []).entries()) {
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
  },
  { error: '获取统计数据失败' },
);
