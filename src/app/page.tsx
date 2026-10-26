'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LogoMark } from '@/components/LogoMark';
import {
  formatSignedAmount,
  getAmountColorClass,
  copyTextToClipboard,
  buildLeaderboardShareText,
} from '@/lib/format';
import { Share2, Sparkles, ChevronRight, Check } from 'lucide-react';

interface LeaderboardItem {
  rank: number;
  userId: number;
  username: string;
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

export default function HomePage() {
  const router = useRouter();
  const { user, openGameEditor, gameSavedVersion } = useApp();

  const [period, setPeriod] = useState<string>('all');
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 复制战报状态提示
  const [copied, setCopied] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/stats?period=${encodeURIComponent(period)}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setLeaderboard(data.leaderboard || []);
      }
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats, gameSavedVersion]);

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
    const text = buildLeaderboardShareText(
      periodLabel,
      summary.totalGames,
      summary.totalRoomFee,
      leaderboard
    );
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const topWinner = leaderboard.find((p) => p.gamesPlayed > 0 && p.netAmount > 0);

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LogoMark size={30} />
          <div>
            <h1 className="text-lg font-black text-slate-900 tracking-tight">
              大赢家 · 战绩榜
            </h1>
            <p className="text-[11px] text-slate-500">熟人麻将 · 房费守护</p>
          </div>
        </div>

        <button
          onClick={handleShareLeaderboard}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-sm active:scale-95 transition"
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
            className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition ${
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
            value={/^\d{4}-\d{2}$/.test(period) ? period : ''}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className={`py-1 px-2 text-xs font-bold rounded-xl border-none focus:outline-none transition ${
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

      {/* 黑金核心概览卡片 */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 p-5 md:p-6 text-white shadow-xl border border-amber-900/40">
        <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-32 h-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />

        <div className="relative flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-amber-300/80 font-medium">
              🤖 {periodLabel}房费总池
            </span>
            <div className="text-3xl font-black tracking-tight text-amber-400 mt-0.5">
              +{summary?.totalRoomFee ?? 0}
            </div>
          </div>
          <div className="text-right">
            <span className="text-[11px] text-slate-400">总场次</span>
            <div className="text-2xl font-bold text-white mt-0.5">
              {summary?.totalGames ?? 0} <span className="text-xs font-normal text-slate-400">局</span>
            </div>
          </div>
        </div>

        {/* 头号大赢家 */}
        {topWinner && (
          <div
            onClick={() => router.push(`/stats?userId=${topWinner.userId}`)}
            className="mt-3.5 flex items-center justify-between pt-1 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <PlayerAvatar
                nickname={topWinner.nickname}
                color={topWinner.avatarColor}
                size="sm"
                isBigWinner
              />
              <div className="text-xs">
                <div className="flex items-center gap-1 font-bold text-amber-200">
                  <Sparkles size={12} className="text-amber-400" />
                  <span>头号赢家：{topWinner.nickname}</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  胜率 {topWinner.winRate}% ｜ 👑大赢家 {topWinner.bigWinnerCount} 次
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-sm font-black text-rose-400">
              <span>{formatSignedAmount(topWinner.netAmount)}</span>
              <ChevronRight size={14} className="text-slate-500" />
            </div>
          </div>
        )}
      </div>

      {/* 排行榜列表 */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 pb-6">
        <div className="flex items-center justify-between px-1 md:col-span-2">
          <h2 className="text-xs font-bold text-slate-500 tracking-wider">
            玩家输赢排行榜 ({leaderboard.length})
          </h2>
          <span className="text-[10px] text-slate-400">红赢 ｜ 绿输</span>
        </div>

        {loading ? (
          <div className="space-y-2 md:col-span-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 rounded-2xl bg-white border border-slate-100 animate-pulse"
              />
            ))}
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="h-36 rounded-2xl bg-white border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 text-xs md:col-span-2">
            <span>暂无战绩记录</span>
            {user?.role === 'ADMIN' && (
              <button
                onClick={openGameEditor}
                className="mt-2 text-amber-600 font-bold underline"
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
                  <div className="w-5 text-center text-xs font-black text-slate-400">
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
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900 truncate">
                        {player.nickname}
                      </span>
                      {isMe && (
                        <span className="px-1.5 py-0.2 rounded-full bg-slate-900 text-amber-300 text-[10px] font-medium scale-90">
                          我
                        </span>
                      )}
                      {player.bigWinnerCount > 0 && (
                        <span className="text-[11px] text-amber-500 font-semibold flex items-center">
                          👑x{player.bigWinnerCount}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {player.gamesPlayed}场 ｜ 胜率 {player.winRate}% ｜ 场均{' '}
                      {formatSignedAmount(player.avgAmount)}
                    </div>
                  </div>
                </div>

                {/* 输赢总金额 */}
                <div className="text-right shrink-0 pl-2">
                  <div
                    className={`text-base font-black tracking-tight ${getAmountColorClass(
                      player.netAmount
                    )}`}
                  >
                    {formatSignedAmount(player.netAmount)}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-end gap-0.5">
                    <span>详情</span>
                    <ChevronRight size={12} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
