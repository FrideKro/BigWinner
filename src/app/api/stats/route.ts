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
  queryPlayerLeaderboardRow,
  queryWinStreaks,
} from '../_lib/statsQueries';
import {
  buildPersonalTrend,
  deriveAchievements,
  excludeTempPlayers,
  mapLeaderboardRows,
  pickPlayerSummary,
} from '../_lib/statsAgg';

type StatsScope = 'board' | 'personal' | 'roomFee' | 'full';

function parseScope(raw: string | null): StatsScope {
  if (raw === 'board' || raw === 'personal' || raw === 'roomFee') {
    return raw;
  }
  return 'full';
}

function queryGlobalRoomFee() {
  const { params: yearRange } = buildPeriodFilter('year', 1);
  const { params: monthRange } = buildPeriodFilter('month', 3);
  return query<{
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
  );
}

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
    // 无 from/to 时 period 已由 buildTimeFilter 校验合法。
    // 仅在请求显式指定内置周期时才复用全局聚合；自定义日期区间（只传 from/to，无 period）
    // 不能落入 'all' 兜底，否则汇总数字会退化为全时段、与区间过滤的榜单口径矛盾
    const period = periodParam || 'all';
    const isBuiltinPeriod =
      periodParam === 'all' || periodParam === 'year' || periodParam === 'month';
    const rawUserId = searchParams.get('userId');
    const targetUserId = rawUserId ? parsePositiveInt(rawUserId) : user.id;
    if (targetUserId === null) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    // scope：
    // - board：概览+总榜（首页，跳过月度房费与个人明细；自定义区间跳过全局三合一查询）
    // - personal：个人战绩走势（看板个人 Tab；带 onlyPersonal=1 时进一步跳过总榜与连胜全表查询）
    // - roomFee：房费专项统计（看板房费 Tab，仅查全站三卡汇总与近 36 个月明细）
    // - full：完整数据（缺省值，保持向后兼容）
    const scope = parseScope(searchParams.get('scope'));
    const onlyPersonal = scope === 'personal' && searchParams.get('onlyPersonal') === '1';

    if (scope === 'roomFee') {
      const [globalRoomFeeRes, monthlyFeeRes] = await Promise.all([
        queryGlobalRoomFee(),
        queryMonthlyFees('', [], 36),
      ]);
      const gRow = globalRoomFeeRes.rows[0];
      const allTimeGames = parseInt(gRow?.all_time_games || '0', 10);
      const allTimeRoomFee = parseInt(gRow?.all_time_fee || '0', 10);
      const thisYearGames = parseInt(gRow?.year_games || '0', 10);
      const thisYearRoomFee = parseInt(gRow?.year_fee || '0', 10);
      const thisMonthGames = parseInt(gRow?.month_games || '0', 10);
      const thisMonthRoomFee = parseInt(gRow?.month_fee || '0', 10);

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

      return NextResponse.json({
        summary: {
          period: 'all',
          totalGames: allTimeGames,
          totalRoomFee: allTimeRoomFee,
          avgRoomFee: allTimeGames > 0 ? Math.round(allTimeRoomFee / allTimeGames) : 0,
          allTimeGames,
          allTimeRoomFee,
          thisYearGames,
          thisYearRoomFee,
          thisMonthGames,
          thisMonthRoomFee,
        },
        leaderboard: [],
        monthlyRoomFees,
        achievements: [],
      });
    }

    const needGlobalSummary = scope === 'full' || (scope === 'board' && isBuiltinPeriod);
    const needPeriodSummary = (scope === 'full' || scope === 'board') && !isBuiltinPeriod;
    const needMonthlyFees = scope === 'full';
    const needFullLeaderboard =
      scope === 'full' || scope === 'board' || (scope === 'personal' && !onlyPersonal);
    const needPersonalHistory = scope === 'full' || scope === 'personal';
    const needWinStreaks =
      scope === 'full' || scope === 'board' || (scope === 'personal' && !onlyPersonal);

    // 查询相互独立，按 scope 精准并行执行
    const [
      periodSummaryRes,
      globalRoomFeeRes,
      monthlyFeeRes,
      leaderboardRes,
      playerRowRes,
      personalHistoryRes,
      winStreaksRes,
    ] = await Promise.all([
      needPeriodSummary ? queryPeriodSummary(clause, params) : Promise.resolve(null),
      needGlobalSummary ? queryGlobalRoomFee() : Promise.resolve(null),
      needMonthlyFees ? queryMonthlyFees('', [], 36) : Promise.resolve(null),
      needFullLeaderboard ? queryLeaderboard(clause, params) : Promise.resolve(null),
      onlyPersonal
        ? queryPlayerLeaderboardRow(clause, params, targetUserId)
        : Promise.resolve(null),
      needPersonalHistory
        ? queryPersonalHistory(clause, params, targetUserId)
        : Promise.resolve(null),
      needWinStreaks ? queryWinStreaks(clause, params) : Promise.resolve(null),
    ]);

    const gRow = globalRoomFeeRes?.rows[0];
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

    const monthlyRoomFees = (monthlyFeeRes?.rows ?? []).map((m) => {
      const gc = parseInt(m.games_count, 10);
      const tf = parseInt(m.total_room_fee, 10);
      return {
        month: m.month,
        gamesCount: gc,
        totalRoomFee: tf,
        avgRoomFee: gc > 0 ? Math.round(tf / gc) : 0,
      };
    });

    // 全量榜单（含临时玩家）供个人面板取数；对外榜单与成就一律过滤临时玩家并重编 rank
    const fullLeaderboard = mapLeaderboardRows(leaderboardRes?.rows ?? playerRowRes?.rows ?? []);
    const leaderboard = onlyPersonal ? [] : excludeTempPlayers(fullLeaderboard);
    const achievements =
      winStreaksRes && !onlyPersonal ? deriveAchievements(leaderboard, winStreaksRes.rows) : [];

    // 指定玩家的极值、连胜连败与累计盈亏曲线（仅 scope=full/personal 有数据）
    const {
      trend,
      maxWinRecord,
      maxLossRecord,
      longestWinStreak,
      longestLossStreak,
      currentStreak,
    } = buildPersonalTrend(personalHistoryRes?.rows ?? []);

    // 指定玩家可能是临时玩家（不对外上榜），个人面板从全量榜单取汇总
    const targetPlayerSummary = pickPlayerSummary(fullLeaderboard, targetUserId);

    return NextResponse.json({
      ...(scope === 'personal'
        ? {}
        : {
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
          }),
      leaderboard,
      monthlyRoomFees,
      ...(onlyPersonal ? {} : { achievements }),
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
