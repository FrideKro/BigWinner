'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TrendChart, TrendPoint } from '@/components/TrendChart';
import { ErrorState } from '@/components/ErrorState';
import { formatSignedAmount, getAmountColorClass, formatDateTime } from '@/lib/format';
import { apiGet, isAbortError } from '@/lib/apiClient';
import { useRefreshOnVisible } from '@/lib/useRefreshOnVisible';
import type { LeaderboardItem, StreakSummary } from '@/app/api/_lib/statsAgg';
import { Flame, Award, TrendingUp, TrendingDown, Coins, Calendar } from 'lucide-react';

// 个人面板 = 总榜汇总字段（不含 rank/isActive）+ 明细计算字段，服务端 /api/stats 同此结构
type PersonalStats = Omit<LeaderboardItem, 'rank' | 'isActive'> & {
  maxWinRecord: {
    amount: number;
    gameId: number;
    playedAt: string;
    note: string;
  } | null;
  maxLossRecord: {
    amount: number;
    gameId: number;
    playedAt: string;
    note: string;
  } | null;
  currentStreak: StreakSummary;
  longestWinStreak: number;
  longestLossStreak: number;
  trend: TrendPoint[];
};

interface MonthlyRoomFeeItem {
  month: string;
  gamesCount: number;
  totalRoomFee: number;
  avgRoomFee: number;
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
  personalStats: PersonalStats;
  monthlyRoomFees: MonthlyRoomFeeItem[];
}

function StatsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="加载中">
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-200 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
            <div className="h-3 w-40 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="h-6 w-16 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 xs:grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-slate-50 animate-pulse" />
          ))}
        </div>
        <div className="h-12 rounded-2xl bg-slate-50 animate-pulse" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-24 rounded-2xl bg-slate-50 animate-pulse" />
          <div className="h-24 rounded-2xl bg-slate-50 animate-pulse" />
        </div>
      </div>
      <div className="h-64 rounded-3xl bg-white border border-slate-100 shadow-sm animate-pulse" />
    </div>
  );
}

function RoomFeeSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="加载中">
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-3xl bg-white border border-slate-100 shadow-sm animate-pulse"
          />
        ))}
      </div>
      <div className="h-24 rounded-3xl bg-amber-50/70 border border-amber-200/60 animate-pulse" />
      <div className="h-52 rounded-3xl bg-white border border-slate-100 shadow-sm animate-pulse" />
    </div>
  );
}

function StatsContent() {
  const searchParams = useSearchParams();
  // 玩家列表由 AppShell 统一拉取并经 context 共享，本页不再重复请求
  const { user, gameSavedVersion, players, getAvatarImage } = useApp();

  const [activeTab, setActiveTab] = useState<'personal' | 'roomFee'>('personal');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [period, setPeriod] = useState<string>('all');
  const [personalStats, setPersonalStats] = useState<PersonalStats | null>(null);
  const [monthlyRoomFees, setMonthlyRoomFees] = useState<MonthlyRoomFeeItem[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const lastVersionRef = useRef(gameSavedVersion);

  // 隐藏玩家不出现在看板选择条，但保留本人查看自己战绩的入口
  const visiblePlayers = useMemo(
    () => players.filter((p) => p.isActive !== false || p.id === user?.id),
    [players, user],
  );

  // 初始选中玩家：URL 指定 > 本人
  useEffect(() => {
    const paramId = searchParams.get('userId');
    if (paramId && !Number.isNaN(parseInt(paramId, 10))) {
      setSelectedUserId(parseInt(paramId, 10));
    } else if (user) {
      setSelectedUserId(user.id);
    }
  }, [searchParams, user]);

  const fetchStats = useCallback(
    async (force = false, showSkeleton = true) => {
      if (!selectedUserId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (showSkeleton) {
        setLoading(true);
        // 切换玩家/周期时旧面板不再适用，清空后展示骨架
        setPersonalStats(null);
      }

      try {
        const data = await apiGet<StatsResponse>(
          `/api/stats?period=${encodeURIComponent(period)}&userId=${selectedUserId}`,
          { force, signal: controller.signal },
        );
        if (abortRef.current !== controller) return;
        setPersonalStats(data.personalStats);
        setMonthlyRoomFees(data.monthlyRoomFees || []);
        setSummary(data.summary);
        setError('');
      } catch (err) {
        if (abortRef.current !== controller || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [period, selectedUserId],
  );

  useEffect(() => {
    void fetchStats(false, true);
  }, [fetchStats]);

  // 记账成功后强制刷新，保留当前面板避免闪烁
  useEffect(() => {
    if (lastVersionRef.current === gameSavedVersion) return;
    lastVersionRef.current = gameSavedVersion;
    void fetchStats(true, false);
  }, [gameSavedVersion, fetchStats]);

  useRefreshOnVisible(() => {
    void fetchStats(true, false);
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  function selectPlayer(id: number) {
    setSelectedUserId(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/stats?userId=${id}`);
    }
  }

  const targetPlayer =
    visiblePlayers.find((p) => p.id === selectedUserId) ||
    (personalStats
      ? {
          id: personalStats.userId,
          nickname: personalStats.nickname,
          avatarColor: personalStats.avatarColor,
        }
      : null);

  const showPersonalSkeleton = loading && !personalStats;

  return (
    <div className="space-y-4 px-4 pt-4 pb-12">
      {/* 顶部主切换 */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200 rounded-2xl">
        <button
          onClick={() => setActiveTab('personal')}
          className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5 transition ${
            activeTab === 'personal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          <Award size={15} />
          <span>个人战绩走势</span>
        </button>
        <button
          onClick={() => setActiveTab('roomFee')}
          className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5 transition ${
            activeTab === 'roomFee' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          <Coins size={15} />
          <span>房费专项统计</span>
        </button>
      </div>

      {activeTab === 'personal' && (
        <div className="space-y-4">
          {/* 玩家横向滚动选择条 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {visiblePlayers.map((p) => {
              const isSelected = p.id === selectedUserId;
              return (
                <button
                  key={p.id}
                  onClick={() => selectPlayer(p.id)}
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
                    src={getAvatarImage(p.id)}
                  />
                  <span className="text-sm font-medium">{p.nickname}</span>
                </button>
              );
            })}
          </div>

          {/* 时间周期筛选 */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-200/60 rounded-xl text-sm">
            {[
              { key: 'all', label: '全部' },
              { key: 'year', label: '本年' },
              { key: 'month', label: '本月' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setPeriod(item.key)}
                className={`flex-1 min-h-9 py-1 rounded-lg font-medium transition ${
                  period === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
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
                className={`min-h-9 py-1 px-1.5 text-sm font-medium rounded-lg border-none focus:outline-none transition ${
                  /^\d{4}-\d{2}$/.test(period)
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'bg-transparent text-slate-600'
                }`}
              >
                <option value="">月份…</option>
                {summary.availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && !personalStats ? (
            <ErrorState message={error} onRetry={() => fetchStats(true, true)} />
          ) : showPersonalSkeleton ? (
            <StatsSkeleton />
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700"
                >
                  <span className="truncate">刷新失败，显示上次数据</span>
                  <button
                    onClick={() => fetchStats(true, false)}
                    className="shrink-0 min-h-9 px-2 font-medium underline"
                  >
                    重试
                  </button>
                </div>
              )}

              {/* 宽屏下面板与走势图并排，窄屏纵向堆叠 */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-start">
                {/* 个人核心数据面板 */}
                {personalStats && targetPlayer && (
                  <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4 lg:col-span-3">
                    <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          nickname={targetPlayer.nickname}
                          color={targetPlayer.avatarColor}
                          size="lg"
                          isBigWinner={personalStats.bigWinnerCount > 0}
                          src={getAvatarImage(targetPlayer.id)}
                        />
                        <div className="min-w-0">
                          <h2 className="text-base font-medium text-slate-900 truncate">
                            {targetPlayer.nickname}
                          </h2>
                          <p className="text-xs text-slate-500">
                            出勤 {personalStats.gamesPlayed} 场 ｜ 👑大赢家{' '}
                            {personalStats.bigWinnerCount} 次
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <span className="text-xs text-slate-500 block whitespace-nowrap">
                          累计总净额
                        </span>
                        <span
                          className={`text-2xl font-black tracking-tight tabular-nums ${getAmountColorClass(
                            personalStats.netAmount,
                          )}`}
                        >
                          {formatSignedAmount(personalStats.netAmount)}
                        </span>
                      </div>
                    </div>

                    {/* 关键指标：窄屏 2×2，宽屏四宫格 */}
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
                          className={`text-sm font-bold tabular-nums ${getAmountColorClass(
                            personalStats.avgAmount,
                          )}`}
                        >
                          {formatSignedAmount(personalStats.avgAmount)}
                        </span>
                      </div>
                      <div className="p-2 rounded-2xl bg-slate-50">
                        <span className="text-xs text-slate-500 block">赢 / 输局</span>
                        <span className="text-sm font-bold text-slate-800 tabular-nums">
                          <b className="text-red-600">{personalStats.winCount}</b>/
                          <b className="text-emerald-600">{personalStats.lossCount}</b>
                        </span>
                      </div>
                      <div className="p-2 rounded-2xl bg-slate-50">
                        <span className="text-xs text-slate-500 block">大赢家率</span>
                        <span className="text-sm font-bold text-amber-600 tabular-nums">
                          {personalStats.bigWinnerRate}%
                        </span>
                      </div>
                    </div>

                    {/* 连红/连黑状态：窄屏上下两行 */}
                    <div className="flex flex-col gap-1.5 p-3 rounded-2xl bg-slate-50 text-sm xs:flex-row xs:items-center xs:justify-between">
                      <div className="flex items-center gap-1.5">
                        <Flame size={16} className="text-amber-500" />
                        <span className="text-slate-600">当前状态：</span>
                        <span className="font-medium">
                          {personalStats.currentStreak.type === 'WIN' && (
                            <span className="text-red-600">
                              连红 {personalStats.currentStreak.count} 场 🔥
                            </span>
                          )}
                          {personalStats.currentStreak.type === 'LOSS' && (
                            <span className="text-emerald-600">
                              连黑 {personalStats.currentStreak.count} 场 🍃
                            </span>
                          )}
                          {personalStats.currentStreak.type === 'NONE' && (
                            <span className="text-slate-500">平稳起步</span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 whitespace-nowrap">
                        最长连胜 {personalStats.longestWinStreak} ｜ 最长连败{' '}
                        {personalStats.longestLossStreak}
                      </div>
                    </div>

                    {/* 巅峰与至暗局 */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-3 rounded-2xl bg-red-50/60 border border-red-100">
                        <div className="flex items-center gap-1 text-red-700 font-medium mb-1">
                          <TrendingUp size={14} />
                          <span>单场最高赢</span>
                        </div>
                        <div className="text-lg font-black text-red-600 tabular-nums">
                          +{personalStats.maxWin}
                        </div>
                        {personalStats.maxWinRecord && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {formatDateTime(personalStats.maxWinRecord.playedAt)}
                          </div>
                        )}
                      </div>

                      <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                        <div className="flex items-center gap-1 text-emerald-700 font-medium mb-1">
                          <TrendingDown size={14} />
                          <span>单场最高输</span>
                        </div>
                        <div className="text-lg font-black text-emerald-600 tabular-nums">
                          {personalStats.maxLoss}
                        </div>
                        {personalStats.maxLossRecord && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {formatDateTime(personalStats.maxLossRecord.playedAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 累计盈亏走势折线图 */}
                <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3 lg:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                      <TrendingUp size={15} className="text-amber-500" />
                      <span>资金累计盈亏走势曲线</span>
                    </h3>
                    <span className="shrink-0 text-xs text-slate-500">拖动查看单场</span>
                  </div>
                  {personalStats && <TrendChart data={personalStats.trend} />}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'roomFee' &&
        (error && !summary ? (
          <ErrorState message={error} onRetry={() => fetchStats(true, true)} />
        ) : loading && !summary ? (
          <RoomFeeSkeleton />
        ) : summary ? (
          <div className="space-y-4">
            {/* 房费汇总三卡片 */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <span className="text-xs text-slate-500 block mb-1">历史总房费</span>
                <span className="text-base font-black text-amber-600 tabular-nums">
                  +{summary.allTimeRoomFee}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">
                  {summary.allTimeGames} 场
                </span>
              </div>

              <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <span className="text-xs text-slate-500 block mb-1">本年房费</span>
                <span className="text-base font-black text-amber-600 tabular-nums">
                  +{summary.thisYearRoomFee}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">
                  {summary.thisYearGames} 场
                </span>
              </div>

              <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
                <span className="text-xs text-slate-500 block mb-1">本月房费</span>
                <span className="text-base font-black text-amber-600 tabular-nums">
                  +{summary.thisMonthRoomFee}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">
                  {summary.thisMonthGames} 场
                </span>
              </div>
            </div>

            {/* 房费规则说明 */}
            <div className="p-4 rounded-3xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900 space-y-1.5">
              <div className="text-sm font-medium flex items-center gap-1 text-amber-800">
                <Coins size={14} />
                <span>房费“固定赢家”铁律</span>
              </div>
              <p className="text-sm text-amber-800/80 leading-relaxed">
                每场房费由房费机器人自动抽取，纳入公共蓄水池（人人有份）。
                每场严格满足：各玩家最终输赢总和 ＋ 本场房费 ＝ 0。
              </p>
            </div>

            {/* 月度房费明细表 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                <Calendar size={15} className="text-amber-500" />
                <span>按月份房费明细</span>
              </h3>

              {monthlyRoomFees.length === 0 ? (
                <div className="text-center py-6 text-sm text-slate-500">暂无月度房费数据</div>
              ) : (
                <div className="space-y-2">
                  {monthlyRoomFees.map((m) => (
                    <div
                      key={m.month}
                      className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100"
                    >
                      <div>
                        <div className="text-xs font-medium text-slate-800">{m.month}</div>
                        <div className="text-xs text-slate-500">
                          共 {m.gamesCount} 场 ｜ 场均房费 {m.avgRoomFee}
                        </div>
                      </div>
                      <div className="text-base font-black text-amber-600 tabular-nums">
                        +{m.totalRoomFee}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null)}
    </div>
  );
}

export default function StatsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-slate-500 text-sm">加载看板中…</div>}>
      <StatsContent />
    </Suspense>
  );
}
