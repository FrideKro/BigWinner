import { NextRequest, NextResponse } from 'next/server';
import { buildDateRangeFilter, buildPeriodFilter } from '@/lib/gameLogic';
import {
  checkRateLimit,
  clearFailures,
  getClientIp,
  getRateLimitState,
  recordFailure,
} from '@/lib/rateLimit';
import { buildPersonalTrend, mapLeaderboardRows, pickPlayerSummary } from '../../_lib/statsAgg';
import {
  fetchShareByCode,
  mapShareGameRows,
  queryShareAvatars,
  queryShareGamesPage,
  queryShareLeaderboard,
  queryShareMonthlyFees,
  querySharePersonalHistory,
  queryShareSummary,
  sharePeriodLabel,
} from '../../_lib/shareData';

// 免登录分享取数接口：凭分享码查看指定时间段的实时数据，不套 withAuth（同 bind 先例）
// 无效分享码按 IP 失败限流 + 全量请求限速；响应一律 no-store，避免中间层缓存分享内容
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;
const GAMES_PAGE_SIZE = 50;
const GAMES_MAX_OFFSET = 2000;
// 全量请求限速：单人活跃会话 15 分钟约 10~30 个请求，留足 NAT 小群共享 IP 的余量；
// 超限基本只剩脚本刷库，单 IP 被压到约 0.2 QPS
const SHARE_RATE_MAX = 200;

// 个人面板 = 总榜汇总（胜率/场均等）+ 明细计算（走势/连击/极值）
type SharePersonalStats = ReturnType<typeof pickPlayerSummary> &
  ReturnType<typeof buildPersonalTrend>;

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function notFound() {
  return jsonError(404, '分享链接不存在或已失效');
}

export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  try {
    const { code: rawCode } = await context.params;
    const code = String(rawCode || '')
      .trim()
      .toLowerCase();
    // 分享码固定 16 位 hex：格式不符直接 404，不落库也不计失败
    if (!/^[0-9a-f]{16}$/.test(code)) {
      return notFound();
    }

    // 限流按 IP 记账；无 x-forwarded-for（直连部署）拿不到真实 IP 时跳过计数——
    // 否则所有匿名访客共享同一个桶，会被无关请求集体 429。分享码 16 位 hex
    // 枚举不可行，此场景放弃限流的代价可接受
    const clientIp = getClientIp(req.headers);
    const ipKey = clientIp ? `share:ip:${clientIp}` : null;
    if (ipKey) {
      // 全量请求限速（成功请求也计数），超限直接 429
      const rate = checkRateLimit(ipKey, SHARE_RATE_MAX);
      if (!rate.allowed) {
        const minutes = Math.max(1, Math.ceil(rate.retryAfterSeconds / 60));
        return jsonError(429, `访问过于频繁，请约 ${minutes} 分钟后再试`);
      }

      // 无效分享码失败限流（同 bind/restore 模式），锁定期间直接 429
      const limitState = getRateLimitState(ipKey);
      if (limitState.locked) {
        const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
        return jsonError(429, `访问次数过多，请约 ${minutes} 分钟后再试`);
      }
    }

    const share = await fetchShareByCode(code);
    if (!share) {
      if (ipKey) recordFailure(ipKey, 10);
      return notFound();
    }
    if (ipKey) clearFailures(ipKey);
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      return jsonError(410, '分享链接已过期');
    }

    const contentScope = share.content_scope
      .split(',')
      .filter((s) => s === 'board' || s === 'games' || s === 'stats');

    const { searchParams } = new URL(req.url);
    const rawTab = searchParams.get('tab') || contentScope[0];
    if (rawTab !== 'board' && rawTab !== 'games' && rawTab !== 'stats') {
      return jsonError(400, '无效的内容类型');
    }
    if (!contentScope.includes(rawTab)) {
      return jsonError(403, '该内容未包含在此分享中');
    }

    // 时间过滤：period 创建时已固化为具体年/月（或 all），复用 buildPeriodFilter；range 用自定义区间
    const filter =
      share.period_type === 'range'
        ? buildDateRangeFilter(share.range_start || '', share.range_end || '', 1)
        : buildPeriodFilter(share.period, 1);
    if (!filter) {
      // 分享参数损坏（创建时已校验，理论不可达），按失效处理
      return notFound();
    }
    const { clause, params } = filter;

    const meta = {
      contentScope,
      periodLabel: sharePeriodLabel(share),
      expiresAt: share.expires_at,
    };

    if (rawTab === 'board') {
      const [summary, leaderboardRes] = await Promise.all([
        queryShareSummary(clause, params),
        queryShareLeaderboard(clause, params),
      ]);
      // 已设置自定义头像的玩家（免登录页按 userId 解析，未设置的落字母主题色头像）
      const avatars = await queryShareAvatars(leaderboardRes.rows.map((r) => r.user_id));
      return NextResponse.json(
        {
          share: meta,
          data: { summary, leaderboard: mapLeaderboardRows(leaderboardRes.rows), avatars },
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    if (rawTab === 'games') {
      const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
      const offset = Number.isInteger(rawOffset)
        ? Math.min(Math.max(rawOffset, 0), GAMES_MAX_OFFSET)
        : 0;
      const gamesRes = await queryShareGamesPage(clause, params, GAMES_PAGE_SIZE + 1, offset);
      // 页裁剪按「超出页大小」判断；hasMore 额外要求未到达 offset 钳位上限——
      // 到达上限后再往后翻页 offset 会被钳回同一页，继续标记会让「加载更多」
      // 陷入重复页死循环
      const hasMoreRaw = gamesRes.rows.length > GAMES_PAGE_SIZE;
      const pageRows = hasMoreRaw ? gamesRes.rows.slice(0, GAMES_PAGE_SIZE) : gamesRes.rows;
      const hasMore = hasMoreRaw && offset + GAMES_PAGE_SIZE <= GAMES_MAX_OFFSET;
      const userIds = [...new Set(pageRows.flatMap((g) => g.records.map((r) => r.userId)))];
      const avatars = await queryShareAvatars(userIds);
      return NextResponse.json(
        {
          share: meta,
          data: { games: mapShareGameRows(pageRows), hasMore, avatars },
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    // stats：房费汇总 + 月度房费 + 总榜（供访客切换玩家与个人汇总），指定玩家明细随后单独查
    const rawUserId = searchParams.get('userId');
    let requestedUserId: number | null = null;
    if (rawUserId !== null) {
      const parsed = parseInt(rawUserId, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return jsonError(400, '无效的玩家 ID');
      }
      requestedUserId = parsed;
    }

    const [summary, leaderboardRes, monthlyRes] = await Promise.all([
      queryShareSummary(clause, params),
      queryShareLeaderboard(clause, params),
      queryShareMonthlyFees(clause, params),
    ]);

    const leaderboard = mapLeaderboardRows(leaderboardRes.rows);
    const players = leaderboard
      .filter((p) => p.gamesPlayed > 0)
      .map((p) => ({ userId: p.userId, nickname: p.nickname, avatarColor: p.avatarColor }));
    const targetUserId = requestedUserId ?? players[0]?.userId ?? null;

    const [personalStatsResult, avatars] = await Promise.all([
      targetUserId !== null
        ? querySharePersonalHistory(clause, params, targetUserId)
        : Promise.resolve(null),
      queryShareAvatars(leaderboard.map((p) => p.userId)),
    ]);
    let personalStats: SharePersonalStats | null = null;
    if (targetUserId !== null && personalStatsResult) {
      personalStats = {
        ...pickPlayerSummary(leaderboard, targetUserId),
        ...buildPersonalTrend(personalStatsResult.rows),
      };
    }

    const monthlyRoomFees = monthlyRes.rows.map((m) => {
      const gamesCount = parseInt(m.games_count, 10);
      const totalRoomFee = parseInt(m.total_room_fee, 10);
      return {
        month: m.month,
        gamesCount,
        totalRoomFee,
        avgRoomFee: gamesCount > 0 ? Math.round(totalRoomFee / gamesCount) : 0,
      };
    });

    return NextResponse.json(
      {
        share: meta,
        data: { summary, monthlyRoomFees, players, personalStats, avatars },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Share view error:', error);
    return jsonError(500, '获取分享数据失败，请稍后重试');
  }
}
