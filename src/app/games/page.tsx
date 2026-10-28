'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import type { GameEditorInitial } from '@/components/GameEditorModal';
import { ErrorState } from '@/components/ErrorState';
import { CopyFallbackModal } from '@/components/CopyFallbackModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  formatDateTime,
  formatSignedAmount,
  getAmountColorClass,
  buildGameShareText,
} from '@/lib/format';
import { apiGet, apiMutate } from '@/lib/apiClient';
import { useCopyText } from '@/lib/useCopyText';
import { useRefreshOnVisible } from '@/lib/useRefreshOnVisible';
import { Share2, Edit2, Trash2, Check } from 'lucide-react';

const GameEditorModal = dynamic(
  () => import('@/components/GameEditorModal').then((m) => m.GameEditorModal),
  { ssr: false },
);

const PAGE_SIZE = 50;

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

interface GamesResponse {
  games: GameItem[];
  hasMore: boolean;
  allTimeTotalGames: number;
  allTimeTotalRoomFee: number;
}

interface MonthsResponse {
  summary?: { availableMonths: string[] };
}

export default function GamesPage() {
  // 玩家列表与默认房费由 AppShell 统一拉取并经 context 共享，本页不再重复请求
  const { user, openGameEditor, gameSavedVersion, players, defaultRoomFee, showToast } = useApp();

  const [games, setGames] = useState<GameItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [allTimeTotalGames, setAllTimeTotalGames] = useState(0);
  const [allTimeRoomFee, setAllTimeRoomFee] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<string>('all');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 单独编辑历史某场战绩
  const [editingGame, setEditingGame] = useState<GameEditorInitial | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // 删除确认
  const [confirmGame, setConfirmGame] = useState<GameItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const offsetRef = useRef(0);
  const fetchedPeriodRef = useRef<string | null>(null);
  const lastVersionRef = useRef(gameSavedVersion);
  const { copy, fallback, clearFallback } = useCopyText();

  const fetchGames = useCallback(
    async (reset: boolean, force = false, showSkeleton = reset) => {
      if (reset) abortRef.current?.abort();
      const controller = new AbortController();
      if (reset) abortRef.current = controller;

      if (showSkeleton) setLoading(true);
      if (!reset) setLoadingMore(true);

      if (reset && fetchedPeriodRef.current !== period) {
        fetchedPeriodRef.current = period;
        offsetRef.current = 0;
        setGames([]);
        setHasMore(false);
      }

      const offset = reset ? 0 : offsetRef.current;

      try {
        const data = await apiGet<GamesResponse>(
          `/api/games?period=${encodeURIComponent(period)}&limit=${PAGE_SIZE}&offset=${offset}`,
          { force, signal: controller.signal },
        );
        setGames((prev) => (reset ? data.games : [...prev, ...data.games]));
        offsetRef.current = offset + data.games.length;
        setHasMore(Boolean(data.hasMore));
        setAllTimeTotalGames(data.allTimeTotalGames || 0);
        setAllTimeRoomFee(data.allTimeTotalRoomFee || 0);
        setError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [period],
  );

  const fetchMonths = useCallback(async (force = false) => {
    try {
      // scope=months：仅取月份列表，避免为下拉筛选拉取整个统计数据
      const data = await apiGet<MonthsResponse>('/api/stats?scope=months', {
        ttl: 60_000,
        force,
      });
      setAvailableMonths(data.summary?.availableMonths || []);
    } catch {
      /* 月份列表失败不影响主列表 */
    }
  }, []);

  useEffect(() => {
    void fetchGames(true);
    void fetchMonths();
  }, [fetchGames, fetchMonths]);

  // 记账成功后强制刷新
  useEffect(() => {
    if (lastVersionRef.current === gameSavedVersion) return;
    lastVersionRef.current = gameSavedVersion;
    void fetchGames(true, true, false);
    void fetchMonths(true);
  }, [gameSavedVersion, fetchGames, fetchMonths]);

  // 回到前台时刷新；已加载多页时跳过，避免丢失“加载更多”的进度
  useRefreshOnVisible(() => {
    if (games.length <= PAGE_SIZE) {
      void fetchGames(true, true, false);
    }
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleShareGame(game: GameItem) {
    const text = buildGameShareText(game, allTimeRoomFee);
    const ok = await copy(text);
    if (ok) {
      setCopiedId(game.id);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      showToast('复制失败，请长按选择文本');
    }
  }

  async function handleDeleteGame() {
    if (!confirmGame) return;
    setDeleting(true);
    try {
      await apiMutate(`/api/games/${confirmGame.id}`, 'DELETE');
      setConfirmGame(null);
      showToast('已删除该场战绩');
      await fetchGames(true, true, false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  function handleOpenEdit(game: GameItem) {
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
              className={`min-h-9 px-2 py-1 rounded-lg font-medium transition ${
                period === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
          {availableMonths.length > 0 && (
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
        {error && games.length === 0 ? (
          <div className="lg:col-span-2">
            <ErrorState message={error} onRetry={() => fetchGames(true, true)} />
          </div>
        ) : loading ? (
          <div className="space-y-3 lg:col-span-2" aria-busy="true" aria-label="加载中">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl bg-white border border-slate-100 animate-pulse"
              />
            ))}
          </div>
        ) : games.length === 0 ? (
          <div className="h-44 rounded-2xl bg-white border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-500 text-sm lg:col-span-2">
            <span>当前筛选暂无场次流水</span>
            {user?.role === 'ADMIN' && (
              <button
                onClick={openGameEditor}
                className="mt-2 min-h-9 text-amber-600 font-medium underline"
              >
                点此记一局
              </button>
            )}
          </div>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700 lg:col-span-2"
              >
                <span className="truncate">刷新失败，显示上次数据</span>
                <button
                  onClick={() => fetchGames(true, true, false)}
                  className="shrink-0 min-h-9 px-2 font-medium underline"
                >
                  重试
                </button>
              </div>
            )}

            {games.map((game) => {
              const isCopied = copiedId === game.id;
              return (
                <div
                  key={game.id}
                  className="p-4 rounded-3xl bg-white border border-slate-100 shadow-sm space-y-3"
                >
                  {/* 单场头部：第一行时间 + 操作；第二行房费 + 备注 */}
                  <div className="space-y-1.5 pb-2 border-b border-slate-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs xs:text-sm font-medium text-slate-800 whitespace-nowrap">
                        {formatDateTime(game.playedAt)}
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleShareGame(game)}
                          aria-label="复制本场微信群战报"
                          title="复制本场微信群战报"
                          className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition active:scale-95"
                        >
                          {isCopied ? (
                            <Check size={16} className="text-emerald-600" />
                          ) : (
                            <Share2 size={16} />
                          )}
                        </button>

                        {user?.role === 'ADMIN' && (
                          <>
                            <button
                              onClick={() => handleOpenEdit(game)}
                              aria-label="编辑战绩"
                              title="编辑战绩"
                              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => setConfirmGame(game)}
                              aria-label="删除战绩"
                              title="删除战绩"
                              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 hover:bg-rose-100 text-rose-600 transition"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
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

                  {/* 本场玩家网格：窄屏单列，避免昵称被截断 */}
                  <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
                    {game.records.map((r) => {
                      const isMe = user?.id === r.userId;
                      return (
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
                            className={`text-base font-black tracking-tight tabular-nums shrink-0 ${getAmountColorClass(
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
            })}

            {hasMore && (
              <button
                onClick={() => fetchGames(false, true, false)}
                disabled={loadingMore || loading}
                className="lg:col-span-2 min-h-11 rounded-2xl bg-white border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50"
              >
                {loadingMore ? '加载中…' : `加载更多（已显示 ${games.length} 场）`}
              </button>
            )}
          </>
        )}
      </div>

      {/* 仅用于编辑历史特定场次的弹窗 */}
      {user?.role === 'ADMIN' && editOpen && editingGame && (
        <GameEditorModal
          open
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
            showToast('已保存修改');
            void fetchGames(true, true, false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmGame !== null}
        title="删除这场战绩？"
        message={
          confirmGame
            ? `${formatDateTime(confirmGame.playedAt)} · ${confirmGame.records
                .map((r) => r.nickname)
                .join('、')}；房费 +${confirmGame.roomFee}。删除后不可恢复。`
            : ''
        }
        confirmText="删除"
        danger
        busy={deleting}
        onConfirm={handleDeleteGame}
        onCancel={() => !deleting && setConfirmGame(null)}
      />

      <CopyFallbackModal text={fallback} onClose={clearFallback} />
    </div>
  );
}
