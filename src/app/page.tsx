'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LogoMark } from '@/components/LogoMark';
import { ErrorState } from '@/components/ErrorState';
import { CopyFallbackModal } from '@/components/CopyFallbackModal';
import { formatSignedAmount, getAmountColorClass, buildLeaderboardShareText } from '@/lib/format';
import { apiGet, isAbortError } from '@/lib/apiClient';
import { useCopyText } from '@/lib/useCopyText';
import { useRefreshOnVisible } from '@/lib/useRefreshOnVisible';
import { Share2, Sparkles, ChevronRight, Check } from 'lucide-react';

interface LeaderboardItem {
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

interface StatsSummary {
  period: string;
  totalGames: number;
  totalRoomFee: number;
  avgRoomFee: number;
  allTimeGames: number;
  allTimeRoomFee: number;
  thisYearGames: number;
  thisYearRoomFee: number;
  thisMonthGames: number;
  thisMonthRoomFee: number;
  availableMonths: string[];
}

interface StatsResponse {
  summary: StatsSummary;
  leaderboard: LeaderboardItem[];
}

export default function HomePage() {
  const router = useRouter();
  const { user, openGameEditor, gameSavedVersion, showToast } = useApp();

  const [period, setPeriod] = useState<string>('all');
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);
  const fetchedPeriodRef = useRef<string | null>(null);
  const { copy, fallback, clearFallback } = useCopyText();

  const fetchStats = useCallback(
    async (force = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 周期变化时旧数据不再适用，显示骨架；同周期后台刷新则保留旧数据
      if (fetchedPeriodRef.current !== period) {
        fetchedPeriodRef.current = period;
        hasDataRef.current = false;
        setSummary(null);
        setLeaderboard([]);
      }
      if (!hasDataRef.current) setLoading(true);
      try {
        // scope=board：首页只需要概览与总榜，跳过个人明细查询并减小响应体积
        const data = await apiGet<StatsResponse>(
          `/api/stats?period=${encodeURIComponent(period)}&scope=board`,
          { force, signal: controller.signal },
        );
        if (abortRef.current !== controller) return;
        setSummary(data.summary);
        setLeaderboard(data.leaderboard || []);
        hasDataRef.current = true;
        setError('');
      } catch (err) {
        if (abortRef.current !== controller || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // 记账成功后强制刷新，绕过客户端缓存
  const lastVersionRef = useRef(gameSavedVersion);
  useEffect(() => {
    if (lastVersionRef.current === gameSavedVersion) return;
    lastVersionRef.current = gameSavedVersion;
    void fetchStats(true);
  }, [gameSavedVersion, fetchStats]);

  useRefreshOnVisible(() => {
    void fetchStats(true);
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  const periodLabel =
    period === 'all'
      ? '历史总榜'
      : period === 'year'
        ? '本年度'
        : period === 'month'
          ? '本月份'
          : `${period}`;

  async function handleShareLeaderboard() {
    if (!summary) return;
    const text = buildLeaderboardShareText(periodLabel, summary.totalGames, leaderboard);
    const ok = await copy(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('复制失败，请长按选择文本');
    }
  }

  const topWinner = leaderboard.find((p) => p.gamesPlayed > 0 && p.netAmount > 0);
  const showSkeleton = loading;

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Logo 与右侧「标题 + 副标题」文字块整体齐高：text-lg 行高 28px + text-xs 行高 16px = 44px */}
          <LogoMark size={44} className="h-11 w-11 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-medium text-slate-900 tracking-tight truncate">
              大赢家 · 战绩榜
            </h1>
            {/* truncate 保证标题块恒为两行 44px，Logo 才能与文字块始终齐高 */}
            <p className="text-xs text-slate-500 truncate">好友娱乐战绩 · 房费记账</p>
          </div>
        </div>

        <button
          onClick={handleShareLeaderboard}
          disabled={!summary}
          aria-label="复制榜单战报"
          className="flex shrink-0 items-center gap-1 px-3 py-2 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700 shadow-sm active:scale-95 transition disabled:opacity-50"
        >
          {copied ? (
            <>
              <Check size={14} className="text-emerald-600" />
              <span className="text-emerald-600">已复制榜单</span>
            </>
          ) : (
            <>
              <Share2 size={14} />
              <span>微信战报</span>
            </>
          )}
        </button>
      </div>

      {/* 时间周期筛选器 */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-2xl">
        {[
          { key: 'all', label: '全部' },
          { key: 'year', label: '本年' },
          { key: 'month', label: '本月' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setPeriod(item.key)}
            className={`flex-1 min-h-10 py-1.5 text-sm font-medium rounded-xl transition ${
              period === item.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
        {summary && summary.availableMonths.length > 0 && (
          <select
            aria-label="选择月份"
            value={/^\d{4}-\d{2}$/.test(period) ? period : ''}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className={`min-h-10 py-1 px-2 text-sm font-medium rounded-xl border-none focus:outline-none transition ${
              /^\d{4}-\d{2}$/.test(period)
                ? 'bg-white text-slate-900 shadow-sm'
                : 'bg-transparent text-slate-600'
            }`}
          >
            <option value="">更多月份…</option>
            {summary.availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && !summary ? (
        <ErrorState message={error} onRetry={() => fetchStats(true)} />
      ) : showSkeleton ? (
        <div className="space-y-4" aria-busy="true" aria-label="加载中">
          <div className="h-40 rounded-3xl bg-slate-200 animate-pulse" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 rounded-2xl bg-white border border-slate-100 animate-pulse"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              <span className="truncate">刷新失败，显示上次数据</span>
              <button
                onClick={() => fetchStats(true)}
                className="shrink-0 min-h-9 px-2 font-medium underline"
              >
                重试
              </button>
            </div>
          )}

          {/* 黑金核心概览卡片：头号赢家为主视觉 */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 p-4 xs:p-5 md:p-6 text-white shadow-xl border border-amber-900/40">
            <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-32 h-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

            {topWinner ? (
              <div
                onClick={() => router.push(`/stats?userId=${topWinner.userId}`)}
                className="relative flex items-center gap-3 cursor-pointer active:opacity-90 transition"
              >
                <PlayerAvatar
                  nickname={topWinner.nickname}
                  color={topWinner.avatarColor}
                  size="lg"
                  isBigWinner
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-xs font-medium text-amber-300/90">
                    <Sparkles size={12} className="text-amber-400 shrink-0" />
                    <span className="truncate">{periodLabel}头号赢家</span>
                  </div>
                  <div className="text-xl font-medium text-amber-100 mt-0.5 truncate">
                    {topWinner.nickname}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 tabular-nums">
                    胜率 {topWinner.winRate}% ｜ 👑大赢家 {topWinner.bigWinnerCount} 次
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-0.5">
                  <span className="text-xl xs:text-2xl md:text-3xl font-black tabular-nums text-rose-400">
                    {formatSignedAmount(topWinner.netAmount)}
                  </span>
                  <ChevronRight size={16} className="text-slate-500" />
                </div>
              </div>
            ) : (
              <div className="relative flex items-center gap-3 py-1">
                <div className="w-12 h-12 shrink-0 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-xl">
                  👑
                </div>
                <div className="min-w-0">
                  <div className="text-base text-slate-300 truncate">
                    {periodLabel}头号赢家虚位以待
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">赢分最高者将荣登此位</div>
                </div>
              </div>
            )}

            {/* 辅助数据行：场次数与房费弱化为脚注 */}
            <div className="relative flex items-center justify-between mt-4 pt-3 border-t border-white/10 text-xs text-slate-400">
              <span>
                {periodLabel}共{' '}
                <span className="text-sm font-bold text-white tabular-nums">
                  {summary?.totalGames ?? 0}
                </span>{' '}
                场
              </span>
              <span>
                🤖 房费池{' '}
                <span className="text-sm font-bold text-amber-400/90 tabular-nums">
                  +{summary?.totalRoomFee ?? 0}
                </span>
              </span>
            </div>
          </div>

          {/* 排行榜列表 */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 pb-6">
            <div className="flex items-center justify-between px-1 md:col-span-2">
              <h2 className="text-sm font-medium text-slate-500 tracking-wider">
                玩家输赢排行榜 ({leaderboard.length})
              </h2>
              <span className="text-xs text-slate-500">红赢 ｜ 绿输</span>
            </div>

            {leaderboard.length === 0 ? (
              <div className="h-36 rounded-2xl bg-white border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-500 text-sm md:col-span-2">
                <span>暂无战绩记录</span>
                {user?.role === 'ADMIN' && (
                  <button
                    onClick={openGameEditor}
                    className="mt-2 min-h-9 text-amber-600 font-medium underline"
                  >
                    点此记第一局
                  </button>
                )}
              </div>
            ) : (
              leaderboard.map((player) => {
                const isMe = user?.id === player.userId;
                return (
                  <div
                    key={player.userId}
                    onClick={() => router.push(`/stats?userId=${player.userId}`)}
                    className={`flex items-center justify-between p-3.5 rounded-2xl bg-white border transition active:scale-[0.99] cursor-pointer shadow-sm ${
                      isMe
                        ? 'border-amber-300 ring-2 ring-amber-100'
                        : 'border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* 排名 */}
                      <div className="w-5 shrink-0 text-center text-xs font-black text-slate-500">
                        {player.gamesPlayed === 0
                          ? '-'
                          : player.rank === 1
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
                      />

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-base font-medium text-slate-900 truncate">
                            {player.nickname}
                          </span>
                          {isMe && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-900 text-amber-300 text-xs font-medium">
                              我
                            </span>
                          )}
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

                    {/* 输赢总金额 */}
                    <div className="text-right shrink-0 pl-2">
                      <div
                        className={`text-base font-black tracking-tight tabular-nums ${getAmountColorClass(
                          player.netAmount,
                        )}`}
                      >
                        {formatSignedAmount(player.netAmount)}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center justify-end gap-0.5">
                        <span>详情</span>
                        <ChevronRight size={12} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <CopyFallbackModal text={fallback} onClose={clearFallback} />
    </div>
  );
}
