'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { GameEditorModal, GameEditorInitial } from '@/components/GameEditorModal';
import {
  formatDateTime,
  formatSignedAmount,
  getAmountColorClass,
  copyTextToClipboard,
  buildGameShareText,
} from '@/lib/format';
import { Share2, Edit2, Trash2, Check } from 'lucide-react';

interface GameItem {
  id: number;
  playedAt: string;
  roomFee: number;
  note: string;
  createdBy: number | null;
  creatorNickname: string | null;
  createdAt: string;
  records: Array<{
    userId: number;
    nickname: string;
    avatarColor: string;
    amount: number;
    isBigWinner: boolean;
  }>;
}

export default function GamesPage() {
  // 玩家列表与默认房费由 AppShell 统一拉取并经 context 共享，本页不再重复请求
  const { user, openGameEditor, gameSavedVersion, players, defaultRoomFee } = useApp();

  const [games, setGames] = useState<GameItem[]>([]);
  const [allTimeTotalGames, setAllTimeTotalGames] = useState(0);
  const [allTimeRoomFee, setAllTimeRoomFee] = useState(0);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>('all');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 单独编辑历史某场战绩
  const [editingGame, setEditingGame] = useState<GameEditorInitial | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const fetchGames = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/games?period=${encodeURIComponent(period)}`);
      if (res.ok) {
        const data = await res.json();
        setGames(data.games || []);
        // 场次总数用接口返回的全量统计，避免被列表 limit=100 截断失真
        setAllTimeTotalGames(data.allTimeTotalGames || 0);
        setAllTimeRoomFee(data.allTimeTotalRoomFee || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [period]);

  const fetchMonths = useCallback(async () => {
    try {
      // scope=months：仅取月份列表，避免为下拉筛选拉取整个统计数据
      const res = await fetch('/api/stats?scope=months');
      if (res.ok) {
        const data = await res.json();
        setAvailableMonths(data.summary?.availableMonths || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchGames();
    fetchMonths();
  }, [fetchGames, fetchMonths, gameSavedVersion]);

  async function handleShareGame(game: GameItem) {
    const text = buildGameShareText(game, allTimeRoomFee);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedId(game.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function handleDeleteGame(id: number) {
    if (!window.confirm(`确定删除这场战绩记录（ID: ${id}）吗？此操作不可撤销。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/games/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchGames();
      } else {
        const data = await res.json();
        alert(data.error || '删除失败');
      }
    } catch {
      alert('网络错误，删除失败');
    }
  }

  function handleOpenEdit(game: GameItem) {
    // 玩家列表由 GameEditorModal 打开时自行兜底刷新，这里只负责回填表单
    setEditingGame({
      id: game.id,
      playedAt: game.playedAt,
      roomFee: game.roomFee,
      note: game.note,
      records: game.records.map((r) => ({
        userId: r.userId,
        amount: r.amount,
      })),
    });
    setEditOpen(true);
  }

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* 头部标题与筛选 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium text-slate-900 tracking-tight">场次流水</h1>
          <p className="text-xs text-slate-500">
            共计 {allTimeTotalGames} 场 ｜ 累计房费 +{allTimeRoomFee}
          </p>
        </div>

        {/* 周期切换 */}
        <div className="flex items-center gap-1 p-0.5 bg-slate-200 rounded-xl text-sm">
          {[
            { key: 'all', label: '全部' },
            { key: 'year', label: '本年' },
            { key: 'month', label: '本月' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setPeriod(item.key)}
              className={`px-2 py-1 rounded-lg font-medium transition ${
                period === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
          {availableMonths.length > 0 && (
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
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 场次列表 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start pb-8">
        {loading ? (
          <div className="space-y-3 lg:col-span-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl bg-white border border-slate-100 animate-pulse"
              />
            ))}
          </div>
        ) : games.length === 0 ? (
          <div className="h-44 rounded-2xl bg-white border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 text-sm lg:col-span-2">
            <span>当前筛选暂无场次流水</span>
            {user?.role === 'ADMIN' && (
              <button
                onClick={openGameEditor}
                className="mt-2 text-amber-600 font-medium underline"
              >
                点此记一局
              </button>
            )}
          </div>
        ) : (
          games.map((game) => {
            const isCopied = copiedId === game.id;
            return (
              <div
                key={game.id}
                className="p-4 rounded-3xl bg-white border border-slate-100 shadow-sm space-y-3"
              >
                {/* 单场头部：时间、备注、房费徽章、复制战报 */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-800">
                      {formatDateTime(game.playedAt)}
                    </span>
                    {game.note && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                        {game.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* 房费徽章 */}
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium text-xs border border-amber-200">
                      🤖 房费 +{game.roomFee}
                    </span>

                    {/* 复制战报按钮 */}
                    <button
                      onClick={() => handleShareGame(game)}
                      title="复制本场微信群战报"
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition active:scale-95"
                    >
                      {isCopied ? (
                        <Check size={14} className="text-emerald-600" />
                      ) : (
                        <Share2 size={14} />
                      )}
                    </button>

                    {/* 管理员操作 */}
                    {user?.role === 'ADMIN' && (
                      <>
                        <button
                          onClick={() => handleOpenEdit(game)}
                          title="编辑战绩"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteGame(game.id)}
                          title="删除战绩"
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-rose-600 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 本场玩家网格 */}
                <div className="grid grid-cols-2 gap-2">
                  {game.records.map((r) => {
                    const isMe = user?.id === r.userId;
                    return (
                      <div
                        key={r.userId}
                        className={`flex items-center justify-between p-2 rounded-xl border ${
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
                          />
                          <span
                            className={`text-sm truncate font-medium ${
                              isMe ? 'text-amber-800' : 'text-slate-700'
                            }`}
                          >
                            {r.nickname}
                          </span>
                        </div>
                        <span
                          className={`text-base font-black tracking-tight shrink-0 pl-1 ${getAmountColorClass(
                            r.amount,
                          )}`}
                        >
                          {formatSignedAmount(r.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 仅用于编辑历史特定场次的弹窗 */}
      {user?.role === 'ADMIN' && (
        <GameEditorModal
          open={editOpen}
          players={players}
          defaultRoomFee={defaultRoomFee}
          initial={editingGame}
          onClose={() => {
            setEditOpen(false);
            setEditingGame(null);
          }}
          onSaved={() => {
            setEditOpen(false);
            setEditingGame(null);
            fetchGames();
          }}
        />
      )}
    </div>
  );
}
