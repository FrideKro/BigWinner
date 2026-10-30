import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildPeriodFilter } from '@/lib/gameLogic';
import { withAuth } from '../_lib/handler';
import {
  buildPersonalTrend,
  mapLeaderboardRows,
  pickPlayerSummary,
  type LeaderboardSqlRow,
  type PersonalHistorySqlRow,
} from '../_lib/statsAgg';

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

    const { params: yearRange } = buildPeriodFilter('year', 1);
    const { params: monthRange } = buildPeriodFilter('month', 3);

    const personalParams = [...params, targetUserId];
    const isBuiltinPeriod = period === 'all' || period === 'year' || period === 'month';

    // 查询相互独立，全部并行执行；
    // period 为 all/year/month 时直接复用 globalRoomFeeRes 的聚合结果，省去第 1 项查询；
    // scope=board 时不发个人明细查询（第 5 项）
    const [periodSummaryRes, globalRoomFeeRes, monthlyFeeRes, leaderboardRes, personalHistoryRes] =
      await Promise.all([
        isBuiltinPeriod
          ? Promise.resolve(null)
          : query<{ total_games: string; total_room_fee: string }>(
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
             COUNT(*) FILTER (WHERE played_at >= $1 AND played_at < $2)::text AS year_games,
             COALESCE(SUM(room_fee) FILTER (WHERE played_at >= $1 AND played_at < $2), 0)::text AS year_fee,
             COUNT(*) FILTER (WHERE played_at >= $3 AND played_at < $4)::text AS month_games,
             COALESCE(SUM(room_fee) FILTER (WHERE played_at >= $3 AND played_at < $4), 0)::text AS month_fee
           FROM games`,
          [...yearRange, ...monthRange],
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
        query<LeaderboardSqlRow>(
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
          ? query<PersonalHistorySqlRow>(
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

    const gRow = globalRoomFeeRes.rows[0];
    const allTimeGames = parseInt(gRow?.all_time_games || '0', 10);
    const allTimeRoomFee = parseInt(gRow?.all_time_fee || '0', 10);
    const thisYearGames = parseInt(gRow?.year_games || '0', 10);
    const thisYearRoomFee = parseInt(gRow?.year_fee || '0', 10);
    const thisMonthGames = parseInt(gRow?.month_games || '0', 10);
    const thisMonthRoomFee = parseInt(gRow?.month_fee || '0', 10);

    let totalGames: number;
    let totalRoomFee: number;
    if (period === 'year') {
      totalGames = thisYearGames;
      totalRoomFee = thisYearRoomFee;
    } else if (period === 'month') {
      totalGames = thisMonthGames;
      totalRoomFee = thisMonthRoomFee;
    } else if (periodSummaryRes) {
      totalGames = parseInt(periodSummaryRes.rows[0]?.total_games || '0', 10);
      totalRoomFee = parseInt(periodSummaryRes.rows[0]?.total_room_fee || '0', 10);
    } else {
      totalGames = allTimeGames;
      totalRoomFee = allTimeRoomFee;
    }

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

    const leaderboard = mapLeaderboardRows(leaderboardRes.rows);

    // 指定玩家的极值、连胜连败与累计盈亏曲线（仅 scope=full 有数据）
    const {
      trend,
      maxWinRecord,
      maxLossRecord,
      longestWinStreak,
      longestLossStreak,
      currentStreak,
    } = buildPersonalTrend(personalHistoryRes?.rows ?? []);

    const targetPlayerSummary = pickPlayerSummary(leaderboard, targetUserId);

    return NextResponse.json({
      summary: {
        period,
        totalGames,
        totalRoomFee,
        avgRoomFee: totalGames > 0 ? Math.round(totalRoomFee / totalGames) : 0,
        allTimeGames,
        allTimeRoomFee,
        thisYearGames,
        thisYearRoomFee,
        thisMonthGames,
        thisMonthRoomFee,
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
