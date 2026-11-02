import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildPeriodFilter, buildTimeFilter } from '@/lib/gameLogic';
import { withAuth } from '../_lib/handler';
import { parsePositiveInt } from '../_lib/params';
import {
  queryLeaderboard,
  queryMonthlyFees,
  queryPersonalHistory,
  queryPeriodSummary,
} from '../_lib/statsQueries';
import { buildPersonalTrend, mapLeaderboardRows, pickPlayerSummary } from '../_lib/statsAgg';

export const GET = withAuth(
  async (req, user) => {
    const { searchParams } = new URL(req.url);
    // 时间过滤：period 或自定义日期区间 from/to 二选一，非法一律 400
    const periodParam = searchParams.get('period');
    const timeFilter = buildTimeFilter(
      periodParam,
      searchParams.get('from'),
      searchParams.get('to'),
    );
    if (timeFilter.error) {
      return NextResponse.json({ error: timeFilter.error }, { status: 400 });
    }
    const { clause, params } = timeFilter;
    // 无 from/to 时 period 已由 buildTimeFilter 校验合法，此处仅用于汇总复用判断
    const period = periodParam || 'all';
    const isBuiltinPeriod = period === 'all' || period === 'year' || period === 'month';
    const rawUserId = searchParams.get('userId');
    const targetUserId = rawUserId ? parsePositiveInt(rawUserId) : user.id;
    if (targetUserId === null) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    // scope：board=概览+总榜（首页，省去个人明细查询与大 payload）；
    // full=完整数据（看板页，缺省值），保持向后兼容
    const rawScope = searchParams.get('scope') || '';
    const scope = rawScope === 'board' ? rawScope : 'full';

    const { params: yearRange } = buildPeriodFilter('year', 1);
    const { params: monthRange } = buildPeriodFilter('month', 3);

    // 查询相互独立，全部并行执行（统计 SQL 统一走 _lib/statsQueries 共享层，
    // 与分享链路 /api/s/[code] 保持同口径）；
    // period 为 all/year/month 时直接复用 globalRoomFeeRes 的聚合结果，省去第 1 项查询；
    // scope=board 时不发个人明细查询（第 5 项）
    const [periodSummaryRes, globalRoomFeeRes, monthlyFeeRes, leaderboardRes, personalHistoryRes] =
      await Promise.all([
        isBuiltinPeriod ? Promise.resolve(null) : queryPeriodSummary(clause, params),
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
        // 房费专项页固定展示全量近 36 个月（不受周期筛选影响，页内无筛选条）
        queryMonthlyFees('', [], 36),
        queryLeaderboard(clause, params),
        scope === 'full'
          ? queryPersonalHistory(clause, params, targetUserId)
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
        period: isBuiltinPeriod ? period : 'custom',
        totalGames,
        totalRoomFee,
        avgRoomFee: totalGames > 0 ? Math.round(totalRoomFee / totalGames) : 0,
        allTimeGames,
        allTimeRoomFee,
        thisYearGames,
        thisYearRoomFee,
        thisMonthGames,
        thisMonthRoomFee,
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
