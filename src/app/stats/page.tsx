'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { TrendChart, TrendPoint } from '@/components/TrendChart';
import { PlayerOption } from '@/components/GameEditorModal';
import {
  formatSignedAmount,
  getAmountColorClass,
  formatDateTime,
} from '@/lib/format';
import {
  Flame,
  Award,
  TrendingUp,
  TrendingDown,
  Coins,
  Calendar,
} from 'lucide-react';

interface PersonalStats {
  userId: number;
  nickname: string;
  avatarColor: string;
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
  currentStreak: { type: 'WIN' | 'LOSS' | 'NONE'; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  trend: TrendPoint[];
}

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

function StatsContent() {
  const searchParams = useSearchParams();
  const { user, gameSavedVersion } = useApp();

  const [activeTab, setActiveTab] = useState<'personal' | 'roomFee'>('personal');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [period, setPeriod] = useState<string>('all');
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [personalStats, setPersonalStats] = useState<PersonalStats | null>(null);
  const [monthlyRoomFees, setMonthlyRoomFees] = useState<MonthlyRoomFeeItem[]>([]);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // 初始化玩家
  useEffect(() => {
    async function loadUsers() {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        const activeList = data.users.map(
          (u: { id: number; nickname: string; avatarColor: string; isActive: boolean }) => ({
            id: u.id,
            nickname: u.nickname,
            avatarColor: u.avatarColor,
            isActive: u.isActive,
          })
        );
        setPlayers(activeList);

        const paramId = searchParams.get('userId');
        if (paramId && !Number.isNaN(parseInt(paramId, 10))) {
          setSelectedUserId(parseInt(paramId, 10));
        } else if (user) {
          setSelectedUserId(user.id);
        } else if (activeList.length > 0) {
          setSelectedUserId(activeList[0].id);
        }
      }
    }
    loadUsers();
  }, [searchParams, user, gameSavedVersion]);

  const fetchStats = useCallback(async () => {
    if (!selectedUserId) return;
    try {
      setLoading(true);
      const res = await fetch(
        `/api/stats?period=${encodeURIComponent(period)}&userId=${selectedUserId}`
      );
      if (res.ok) {
        const data = await res.json();
        setPersonalStats(data.personalStats);
        setMonthlyRoomFees(data.monthlyRoomFees || []);
        setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }, [period, selectedUserId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats, gameSavedVersion]);

  const targetPlayer =
    players.find((p) => p.id === selectedUserId) ||
    (personalStats
      ? {
          id: personalStats.userId,
          nickname: personalStats.nickname,
          avatarColor: personalStats.avatarColor,
        }
      : null);

  return (
    <div className="space-y-4 px-4 pt-4 pb-12">
      {/* 顶部主切换 */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200 rounded-2xl">
        <button
          onClick={() => setActiveTab('personal')}
          className={`flex-1 py-2 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5 transition ${
            activeTab === 'personal'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600'
          }`}
        >
          <Award size={15} />
          <span>个人战绩走势</span>
        </button>
        <button
          onClick={() => setActiveTab('roomFee')}
          className={`flex-1 py-2 text-sm font-medium rounded-xl flex items-center justify-center gap-1.5 transition ${
            activeTab === 'roomFee'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600'
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
            {players.map((p) => {
              const isSelected = p.id === selectedUserId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedUserId(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shrink-0 transition ${
                    isSelected
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  <PlayerAvatar nickname={p.nickname} color={p.avatarColor} size="sm" />
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
                className={`flex-1 py-1 rounded-lg font-medium transition ${
                  period === item.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                {item.label}
              </button>
            ))}
            {summary && summary.availableMonths.length > 0 && (
              <select
                value={/^\d{4}-\d{2}$/.test(period) ? period : ''}
                onChange={(e) => e.target.value && setPeriod(e.target.value)}
                className={`py-1 px-1.5 text-sm font-medium rounded-lg border-none focus:outline-none transition ${
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

          {/* 宽屏下面板与走势图并排，窄屏纵向堆叠 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-start">
          {/* 个人核心数据面板 */}
          {personalStats && targetPlayer && (
            <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4 lg:col-span-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <PlayerAvatar
                    nickname={targetPlayer.nickname}
                    color={targetPlayer.avatarColor}
                    size="lg"
                    isBigWinner={personalStats.bigWinnerCount > 0}
                  />
                  <div>
                    <h2 className="text-base font-medium text-slate-900">
                      {targetPlayer.nickname}
                    </h2>
                    <p className="text-xs text-slate-400">
                      出勤 {personalStats.gamesPlayed} 场 ｜ 👑大赢家{' '}
                      {personalStats.bigWinnerCount} 次
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs text-slate-400 block">累计总净额</span>
                  <span
                    className={`text-2xl font-black tracking-tight ${getAmountColorClass(
                      personalStats.netAmount
                    )}`}
                  >
                    {formatSignedAmount(personalStats.netAmount)}
                  </span>
                </div>
              </div>

              {/* 关键指标四宫格 */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded-2xl bg-slate-50">
                  <span className="text-xs text-slate-400 block">胜率</span>
                  <span className="text-sm font-bold text-slate-800">
                    {personalStats.winRate}%
                  </span>
                </div>
                <div className="p-2 rounded-2xl bg-slate-50">
                  <span className="text-xs text-slate-400 block">场均盈亏</span>
                  <span
                    className={`text-sm font-bold ${getAmountColorClass(
                      personalStats.avgAmount
                    )}`}
                  >
                    {formatSignedAmount(personalStats.avgAmount)}
                  </span>
                </div>
                <div className="p-2 rounded-2xl bg-slate-50">
                  <span className="text-xs text-slate-400 block">赢 / 输局</span>
                  <span className="text-sm font-bold text-slate-800">
                    <b className="text-red-600">{personalStats.winCount}</b>/
                    <b className="text-emerald-600">{personalStats.lossCount}</b>
                  </span>
                </div>
                <div className="p-2 rounded-2xl bg-slate-50">
                  <span className="text-xs text-slate-400 block">大赢家率</span>
                  <span className="text-sm font-bold text-amber-600">
                    {personalStats.bigWinnerRate}%
                  </span>
                </div>
              </div>

              {/* 连红/连黑状态 */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 text-sm">
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
                <div className="text-xs text-slate-400">
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
                  <div className="text-lg font-black text-red-600">
                    +{personalStats.maxWin}
                  </div>
                  {personalStats.maxWinRecord && (
                    <div className="text-xs text-slate-400 truncate mt-0.5">
                      {formatDateTime(personalStats.maxWinRecord.playedAt)}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                  <div className="flex items-center gap-1 text-emerald-700 font-medium mb-1">
                    <TrendingDown size={14} />
                    <span>单场最高输</span>
                  </div>
                  <div className="text-lg font-black text-emerald-600">
                    {personalStats.maxLoss}
                  </div>
                  {personalStats.maxLossRecord && (
                    <div className="text-xs text-slate-400 truncate mt-0.5">
                      {formatDateTime(personalStats.maxLossRecord.playedAt)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 累计盈亏走势折线图 */}
          <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                <TrendingUp size={15} className="text-amber-500" />
                <span>资金累计盈亏走势曲线</span>
              </h3>
              <span className="text-xs text-slate-400">点击节点查看单场</span>
            </div>
            {personalStats && <TrendChart data={personalStats.trend} />}
          </div>
          </div>
        </div>
      )}

      {activeTab === 'roomFee' && summary && (
        <div className="space-y-4">
          {/* 房费汇总三卡片 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
              <span className="text-xs text-slate-400 block mb-1">历史总房费</span>
              <span className="text-base font-black text-amber-600">
                +{summary.allTimeRoomFee}
              </span>
              <span className="text-xs text-slate-400 block mt-0.5">
                {summary.allTimeGames} 场
              </span>
            </div>

            <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
              <span className="text-xs text-slate-400 block mb-1">本年房费</span>
              <span className="text-base font-black text-amber-600">
                +{summary.thisYearRoomFee}
              </span>
              <span className="text-xs text-slate-400 block mt-0.5">
                {summary.thisYearGames} 场
              </span>
            </div>

            <div className="p-3.5 rounded-3xl bg-white border border-slate-100 shadow-sm">
              <span className="text-xs text-slate-400 block mb-1">本月房费</span>
              <span className="text-base font-black text-amber-600">
                +{summary.thisMonthRoomFee}
              </span>
              <span className="text-xs text-slate-400 block mt-0.5">
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
              每场房费由牌桌机器人自动抽取，纳入公共蓄水池（人人有份）。
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
              <div className="text-center py-6 text-sm text-slate-400">
                暂无月度房费数据
              </div>
            ) : (
              <div className="space-y-2">
                {monthlyRoomFees.map((m) => (
                  <div
                    key={m.month}
                    className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100"
                  >
                    <div>
                      <div className="text-xs font-medium text-slate-800">
                        {m.month}
                      </div>
                      <div className="text-xs text-slate-400">
                        打牌 {m.gamesCount} 场 ｜ 场均房费 {m.avgRoomFee}
                      </div>
                    </div>
                    <div className="text-base font-black text-amber-600">
                      +{m.totalRoomFee}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StatsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-center text-slate-400 text-sm">加载看板中…</div>
      }
    >
      <StatsContent />
    </Suspense>
  );
}
