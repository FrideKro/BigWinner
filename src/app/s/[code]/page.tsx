'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LogoMark } from '@/components/LogoMark';
import { TrendChart, TrendPoint } from '@/components/TrendChart';
import { ErrorState } from '@/components/ErrorState';
import { ApiError, apiGet, isAbortError } from '@/lib/apiClient';
import {
  formatDateTime,
  formatSignedAmount,
  formatShareExpiryDate,
  getAmountColorClass,
} from '@/lib/format';
import type { LeaderboardItem } from '@/app/api/_lib/statsAgg';
import { Sparkles, Trophy, ListOrdered, BarChart3 } from 'lucide-react';

// 免登录分享页：凭 /s/{code} 查看指定时间段的实时数据，只读、无登录态依赖
// 数据来自公开接口 /api/s/[code]，404/410 展示失效态

const TAB_OPTIONS = [
  { key: 'board', label: '总榜', icon: Trophy },
  { key: 'games', label: '流水', icon: ListOrdered },
  { key: 'stats', label: '看板', icon: BarChart3 },
] as const;
type ShareTab = (typeof TAB_OPTIONS)[number]['key'];

interface ShareMeta {
  contentScope: ShareTab[];
  periodLabel: string;
  expiresAt: string | null;
}

interface ShareSummary {
  totalGames: number;
  totalRoomFee: number;
  avgRoomFee: number;
}

interface BoardData {
  summary: ShareSummary;
  leaderboard: LeaderboardItem[];
  /** userId → 自定义头像图片（仅含已设置的玩家），未设置落字母主题色头像 */
  avatars: Record<string, string>;
}

interface GameRecordItem {
  userId: number;
  nickname: string;
  avatarColor: string;
  amount: number;
  isBigWinner: boolean;
}

interface GameItem {
  id: number;
  playedAt: string;
  roomFee: number;
  note: string;
  createdBy: number | null;
  creatorNickname: string | null;
  createdAt: string;
  records: GameRecordItem[];
}

interface GamesData {
  games: GameItem[];
  hasMore: boolean;
  avatars: Record<string, string>;
}

interface MonthlyRoomFeeItem {
  month: string;
  gamesCount: number;
  totalRoomFee: number;
  avgRoomFee: number;
}

interface PersonalStats extends LeaderboardItem {
  maxWinRecord: { amount: number; gameId: number; playedAt: string; note: string } | null;
  maxLossRecord: { amount: number; gameId: number; playedAt: string; note: string } | null;
  currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  trend: TrendPoint[];
}

interface StatsData {
  summary: ShareSummary;
  monthlyRoomFees: MonthlyRoomFeeItem[];
  players: Array<{ userId: number; nickname: string; avatarColor: string }>;
  personalStats: PersonalStats | null;
  avatars: Record<string, string>;
}

interface ShareViewResponse {
  share: ShareMeta;
  data: BoardData | GamesData | StatsData;
}

function isBoardData(data: ShareViewResponse['data']): data is BoardData {
  return 'leaderboard' in data;
}

function isGamesData(data: ShareViewResponse['data']): data is GamesData {
  return 'games' in data;
}

function isStatsData(data: ShareViewResponse['data']): data is StatsData {
  return 'personalStats' in data;
}

function streakLabel(streak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number }): string {
  if (streak.type === 'WIN') return `${streak.count} 连赢`;
  if (streak.type === 'LOSS') return `${streak.count} 连输`;
  return '—';
}

export default function SharePage() {
  const { code } = useParams() as { code: string };

  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [tab, setTab] = useState<ShareTab>('board');
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [games, setGames] = useState<GameItem[]>([]);
  const [gamesHasMore, setGamesHasMore] = useState(false);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  // userId → 自定义头像图片（随各 tab 响应下发；games 追加翻页时增量合并）
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [statsUserId, setStatsUserId] = useState<number | null>(null);
  const [invalid, setInvalid] = useState<{ title: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const gamesOffsetRef = useRef(0);

  // 404/410/403 属于链接失效或越权访问，展示不可恢复的失效态
  const handleFetchError = useCallback((err: unknown) => {
    if (isAbortError(err)) return;
    if (
      err instanceof ApiError &&
      (err.status === 404 || err.status === 410 || err.status === 403)
    ) {
      setInvalid({
        title: err.status === 410 ? '链接已过期' : '链接已失效',
        message: err.message,
      });
    } else {
      setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
    }
  }, []);

  const fetchTabData = useCallback(
    async (
      targetTab: ShareTab | null,
      options: { append?: boolean; userId?: number | null } = {},
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const offset = options.append ? gamesOffsetRef.current : 0;
      let url = `/api/s/${code}`;
      if (targetTab) url += `?tab=${targetTab}`;
      if (targetTab === 'games') url += `&offset=${offset}`;
      if (targetTab === 'stats' && options.userId) url += `&userId=${options.userId}`;

      if (!options.append) setLoading(true);
      try {
        const res = await apiGet<ShareViewResponse>(url, { force: true });
        if (abortRef.current !== controller) return;
        setMeta(res.share);
        const nextAvatars = res.data.avatars ?? {};
        setAvatars((prev) => (options.append ? { ...prev, ...nextAvatars } : nextAvatars));
        // 未指定 tab 时服务端返回第一个已分享模块的数据，需同步 tab 状态，
        // 否则首个模块非「总榜」的分享会因渲染条件不命中而白屏
        const actualTab = targetTab || res.share.contentScope[0] || 'board';
        setTab(actualTab);
        if (actualTab === 'board' && isBoardData(res.data)) {
          setBoardData(res.data);
        } else if (actualTab === 'games' && isGamesData(res.data)) {
          const page = res.data.games;
          setGames((prev) => (options.append ? [...prev, ...page] : page));
          gamesOffsetRef.current = offset + page.length;
          setGamesHasMore(res.data.hasMore);
        } else if (actualTab === 'stats' && isStatsData(res.data)) {
          setStatsData(res.data);
          if (!options.userId) {
            setStatsUserId(res.data.personalStats?.userId ?? null);
          }
        }
        setError('');
      } catch (err) {
        if (abortRef.current !== controller) return;
        handleFetchError(err);
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [code, handleFetchError],
  );

  // 首次进入：不带 tab 参数，服务端默认返回第一个已分享模块的数据
  useEffect(() => {
    void fetchTabData(null);
    return () => abortRef.current?.abort();
  }, [fetchTabData]);

  // 告知微信/浏览器当前页面标题
  useEffect(() => {
    document.title = meta ? `${meta.periodLabel} · 大赢家战绩分享` : '大赢家 · 战绩分享';
  }, [meta]);

  function switchTab(next: ShareTab) {
    if (next === tab) return;
    setTab(next);
    setError('');
    void fetchTabData(next, { userId: next === 'stats' ? statsUserId : undefined });
  }

  function selectStatsPlayer(userId: number) {
    setStatsUserId(userId);
    void fetchTabData('stats', { userId });
  }

  function loadMoreGames() {
    setLoadingMore(true);
    void fetchTabData('games', { append: true });
  }

  // 链接失效态
  if (invalid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <LogoMark size={48} className="opacity-40" />
        <h1 className="mt-3 text-base font-medium text-slate-900">{invalid.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{invalid.message}</p>
      </div>
    );
  }

  const loadingSkeleton = (
    <div className="space-y-4" aria-busy="true" aria-label="加载中">
      <div className="h-40 rounded-3xl bg-slate-200 animate-pulse" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-2xl bg-white border border-slate-100 animate-pulse"
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="px-4 pt-4 pb-12 space-y-4">
      {/* 分享头部 */}
      <div className="flex items-center gap-2.5">
        <LogoMark size={44} className="h-11 w-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-medium text-slate-900 tracking-tight truncate">
            大赢家 · 战绩分享
          </h1>
          <p className="text-xs text-slate-500 truncate">
            {meta
              ? `${meta.periodLabel} ｜ ${meta.expiresAt ? `有效期至 ${formatShareExpiryDate(meta.expiresAt) ?? ''}` : '永久有效'}`
              : '加载中…'}
          </p>
        </div>
      </div>

      {/* 内容模块切换（仅多模块时显示） */}
      {meta && meta.contentScope.length > 1 && (
        <div className="flex items-center gap-1 p-1 bg-slate-200 rounded-2xl">
          {TAB_OPTIONS.filter((o) => meta.contentScope.includes(o.key)).map((o) => (
            <button
              key={o.key}
              onClick={() => switchTab(o.key)}
              aria-pressed={tab === o.key}
              className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5 transition ${
                tab === o.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <o.icon size={15} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}

      {error && !loading ? (
        <ErrorState
          message={error}
          onRetry={() =>
            // meta 为空说明首载就失败（tab 状态不可信），不带 tab 参数走服务端默认模块
            fetchTabData(meta ? tab : null, { userId: tab === 'stats' ? statsUserId : undefined })
          }
        />
      ) : loading ? (
        loadingSkeleton
      ) : (
        <>
          {tab === 'board' && boardData && renderBoard(boardData)}
          {tab === 'games' && renderGames()}
          {tab === 'stats' && statsData && renderStats(statsData)}
        </>
      )}
    </div>
  );

  function renderBoard(data: BoardData) {
    const { summary } = data;
    // 与首页总榜口径一致：时间段内 0 记录的玩家不上榜
    const leaderboard = data.leaderboard.filter((p) => p.gamesPlayed > 0);
    const topWinner = leaderboard.find((p) => p.gamesPlayed > 0 && p.netAmount > 0);

    return (
      <div className="space-y-4">
        {/* 黑金核心概览卡片：头号赢家为主视觉（只读） */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 p-4 xs:p-5 text-white shadow-xl border border-amber-900/40">
          <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-32 h-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

          {topWinner ? (
            <div className="relative flex items-center gap-3">
              <PlayerAvatar
                nickname={topWinner.nickname}
                color={topWinner.avatarColor}
                size="lg"
                isBigWinner
                src={avatars[String(topWinner.userId)]}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs font-medium text-amber-300/90">
                  <Sparkles size={12} className="text-amber-400 shrink-0" />
                  <span className="truncate">{meta?.periodLabel}头号赢家</span>
                </div>
                <div className="text-xl font-medium text-amber-100 mt-0.5 truncate">
                  {topWinner.nickname}
                </div>
                <div className="text-xs text-slate-400 mt-1 tabular-nums">
                  胜率 {topWinner.winRate}% ｜ 👑大赢家 {topWinner.bigWinnerCount} 次
                </div>
              </div>
              <div className="shrink-0">
                <span className="text-xl xs:text-2xl font-black tabular-nums text-rose-400">
                  {formatSignedAmount(topWinner.netAmount)}
                </span>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center gap-3 py-1">
              <div className="w-12 h-12 shrink-0 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-xl">
                👑
              </div>
              <div className="min-w-0">
                <div className="text-base text-slate-300 truncate">头号赢家虚位以待</div>
                <div className="text-xs text-slate-500 mt-0.5">该时间段暂无胜负记录</div>
              </div>
            </div>
          )}

          <div className="relative flex items-center justify-between mt-4 pt-3 border-t border-white/10 text-xs text-slate-400">
            <span>
              共{' '}
              <span className="text-sm font-bold text-white tabular-nums">
                {summary.totalGames}
              </span>{' '}
              场
            </span>
            <span>
              🤖 房费池{' '}
              <span className="text-sm font-bold text-amber-400/90 tabular-nums">
                +{summary.totalRoomFee}
              </span>
            </span>
          </div>
        </div>

        {/* 排行榜列表（只读） */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium text-slate-500 tracking-wider">
              玩家输赢排行榜 ({leaderboard.length})
            </h2>
            <span className="text-xs text-slate-500">红赢 ｜ 绿输</span>
          </div>

          {leaderboard.length === 0 ? (
            <div className="h-36 rounded-2xl bg-white border border-dashed border-slate-200 flex items-center justify-center text-slate-500 text-sm">
              该时间段暂无战绩记录
            </div>
          ) : (
            leaderboard.map((player) => (
              <div
                key={player.userId}
                className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-5 shrink-0 text-center text-xs font-black text-slate-500">
                    {/* 榜单渲染前已过滤 0 记录玩家，rank 恒有效 */}
                    {player.rank === 1
                      ? '🥇'
                      : player.rank === 2
                        ? '🥈'
                        : player.rank === 3
                          ? '🥉'
                          : player.rank}
                  </div>

                  <PlayerAvatar
                    nickname={player.nickname}
                    color={player.avatarColor}
                    size="md"
                    isBigWinner={player.bigWinnerCount > 0 && player.rank === 1}
                    src={avatars[String(player.userId)]}
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-base font-medium text-slate-900 truncate">
                        {player.nickname}
                      </span>
                      {player.bigWinnerCount > 0 && (
                        <span className="shrink-0 text-xs text-amber-600 font-medium flex items-center">
                          👑x{player.bigWinnerCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      {player.gamesPlayed}场 ｜ 胜率 {player.winRate}% ｜ 场均{' '}
                      {formatSignedAmount(player.avgAmount)}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-2">
                  <div
                    className={`text-base font-black tracking-tight tabular-nums ${getAmountColorClass(
                      player.netAmount,
                    )}`}
                  >
                    {formatSignedAmount(player.netAmount)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderGames() {
    return (
      <div className="space-y-3">
        {games.length === 0 ? (
          <div className="h-44 rounded-2xl bg-white border border-dashed border-slate-200 flex items-center justify-center text-slate-500 text-sm">
            该时间段暂无场次流水
          </div>
        ) : (
          games.map((game) => (
            <div
              key={game.id}
              className="p-4 rounded-3xl bg-white border border-slate-100 shadow-sm space-y-3"
            >
              {/* 单场头部：时间 + 房费 + 备注 */}
              <div className="space-y-1.5 pb-2 border-b border-slate-100">
                <div className="text-xs xs:text-sm font-medium text-slate-800">
                  {formatDateTime(game.playedAt)}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium text-xs border border-amber-200">
                    🤖 房费 +{game.roomFee}
                  </span>
                  {game.note && (
                    <span className="min-w-0 truncate px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                      {game.note}
                    </span>
                  )}
                </div>
              </div>

              {/* 本场玩家网格 */}
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
                {game.records.map((r) => (
                  <div
                    key={r.userId}
                    className={`flex items-center justify-between gap-2 p-2 rounded-xl border ${
                      r.isBigWinner
                        ? 'bg-amber-50/60 border-amber-200'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <PlayerAvatar
                        nickname={r.nickname}
                        color={r.avatarColor}
                        size="sm"
                        isBigWinner={r.isBigWinner}
                        src={avatars[String(r.userId)]}
                      />
                      <span className="text-sm truncate font-medium text-slate-700">
                        {r.nickname}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-black tabular-nums ${getAmountColorClass(r.amount)}`}
                    >
                      {formatSignedAmount(r.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {gamesHasMore && (
          <button
            onClick={loadMoreGames}
            disabled={loadingMore}
            className="w-full min-h-11 rounded-2xl bg-white border border-slate-200 text-sm font-medium text-slate-600 active:scale-[0.99] transition disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '加载更多场次'}
          </button>
        )}
      </div>
    );
  }

  function renderStats(data: StatsData) {
    const { summary, monthlyRoomFees, players, personalStats } = data;

    return (
      <div className="space-y-4">
        {/* 时间段房费汇总 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3 text-center">
            <span className="text-xs text-slate-500 block">场次</span>
            <span className="text-base font-bold text-slate-800 tabular-nums">
              {summary.totalGames}
            </span>
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3 text-center">
            <span className="text-xs text-slate-500 block">总房费</span>
            <span className="text-base font-bold text-amber-600 tabular-nums">
              +{summary.totalRoomFee}
            </span>
          </div>
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3 text-center">
            <span className="text-xs text-slate-500 block">场均房费</span>
            <span className="text-base font-bold text-slate-800 tabular-nums">
              {summary.avgRoomFee}
            </span>
          </div>
        </div>

        {/* 月度房费明细（跨月时间段才有多行） */}
        {monthlyRoomFees.length > 1 && (
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4 space-y-2">
            <h3 className="text-sm font-medium text-slate-500">月度房费</h3>
            <div className="space-y-1.5">
              {monthlyRoomFees.map((m) => (
                <div key={m.month} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 tabular-nums">{m.month}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {m.gamesCount} 场 ｜ 均价 {m.avgRoomFee} ｜{' '}
                    <span className="text-amber-600 font-bold">+{m.totalRoomFee}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 玩家切换条 */}
        {players.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {players.map((p) => {
              const isSelected = p.userId === statsUserId;
              return (
                <button
                  key={p.userId}
                  onClick={() => selectStatsPlayer(p.userId)}
                  aria-pressed={isSelected}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shrink-0 transition ${
                    isSelected
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <PlayerAvatar
                    nickname={p.nickname}
                    color={p.avatarColor}
                    size="sm"
                    src={avatars[String(p.userId)]}
                  />
                  <span className="text-sm font-medium">{p.nickname}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 个人面板 + 走势图 */}
        {personalStats ? (
          <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <PlayerAvatar
                  nickname={personalStats.nickname}
                  color={personalStats.avatarColor}
                  size="lg"
                  isBigWinner={personalStats.bigWinnerCount > 0}
                  src={avatars[String(personalStats.userId)]}
                />
                <div className="min-w-0">
                  <h2 className="text-base font-medium text-slate-900 truncate">
                    {personalStats.nickname}
                  </h2>
                  <p className="text-xs text-slate-500">
                    出勤 {personalStats.gamesPlayed} 场 ｜ 👑大赢家 {personalStats.bigWinnerCount}{' '}
                    次
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-xs text-slate-500 block whitespace-nowrap">累计总净额</span>
                <span
                  className={`text-2xl font-black tracking-tight tabular-nums ${getAmountColorClass(
                    personalStats.netAmount,
                  )}`}
                >
                  {formatSignedAmount(personalStats.netAmount)}
                </span>
              </div>
            </div>

            {/* 关键指标 2×2 */}
            <div className="grid grid-cols-2 xs:grid-cols-4 gap-2 text-center">
              <div className="p-2 rounded-2xl bg-slate-50">
                <span className="text-xs text-slate-500 block">胜率</span>
                <span className="text-sm font-bold text-slate-800 tabular-nums">
                  {personalStats.winRate}%
                </span>
              </div>
              <div className="p-2 rounded-2xl bg-slate-50">
                <span className="text-xs text-slate-500 block">场均盈亏</span>
                <span
                  className={`text-sm font-bold tabular-nums ${getAmountColorClass(personalStats.avgAmount)}`}
                >
                  {formatSignedAmount(personalStats.avgAmount)}
                </span>
              </div>
              <div className="p-2 rounded-2xl bg-slate-50">
                <span className="text-xs text-slate-500 block">最大单赢</span>
                <span className="text-sm font-bold text-red-600 tabular-nums">
                  {personalStats.maxWin > 0 ? `+${personalStats.maxWin}` : '—'}
                </span>
              </div>
              <div className="p-2 rounded-2xl bg-slate-50">
                <span className="text-xs text-slate-500 block">最大单输</span>
                <span className="text-sm font-bold text-emerald-600 tabular-nums">
                  {personalStats.maxLoss < 0 ? personalStats.maxLoss : '—'}
                </span>
              </div>
            </div>

            {/* 连击概览 */}
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                当前{' '}
                <span className="font-medium text-slate-800">
                  {streakLabel(personalStats.currentStreak)}
                </span>
              </span>
              <span>最长连赢 {personalStats.longestWinStreak}</span>
              <span>最长连输 {personalStats.longestLossStreak}</span>
            </div>

            {/* 累计盈亏走势 */}
            {personalStats.trend.length > 0 && <TrendChart data={personalStats.trend} />}
          </div>
        ) : (
          <div className="h-36 rounded-2xl bg-white border border-dashed border-slate-200 flex items-center justify-center text-slate-500 text-sm">
            该时间段暂无玩家战绩
          </div>
        )}
      </div>
    );
  }
}
