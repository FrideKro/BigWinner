'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Wand2, Plus, Minus, Trash2 } from 'lucide-react';
import { PlayerAvatar } from './PlayerAvatar';
import { ConfirmDialog } from './ConfirmDialog';
import { toDatetimeLocalValue, toTodayDatetimeLocalValue, shanghaiInputToIso } from '@/lib/format';
import { MAX_GAME_NOTE_LENGTH } from '@/lib/profileValidation';
import { apiMutate } from '@/lib/apiClient';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useFocusTrap } from '@/lib/useFocusTrap';

export interface GameRecordInput {
  userId: number;
  nickname: string;
  avatarColor: string;
  amount: number | null; // null 表示未填
}

export interface GameEditorInitial {
  id?: number;
  playedAt: string;
  roomFee: number;
  note: string;
  records: Array<{ userId: number; amount: number }>;
}

export interface PlayerOption {
  id: number;
  nickname: string;
  avatarColor: string;
  isActive?: boolean;
}

interface GameEditorModalProps {
  open: boolean;
  players: PlayerOption[];
  defaultRoomFee: number;
  initial?: GameEditorInitial | null;
  onClose: () => void;
  onSaved: () => void;
}

export function GameEditorModal({
  open,
  players,
  defaultRoomFee,
  initial,
  onClose,
  onSaved,
}: GameEditorModalProps) {
  const [modalPlayers, setModalPlayers] = useState<PlayerOption[]>(players);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // rawAmounts 存非负数值，null 为未填
  const [rawAmounts, setRawAmounts] = useState<Record<number, number | null>>({});
  // signs 单独存正负号：1 为赢，-1 为输
  const [signs, setSigns] = useState<Record<number, 1 | -1>>({});
  const [roomFee, setRoomFee] = useState<number>(defaultRoomFee);
  const [roomFeeStr, setRoomFeeStr] = useState<string>(String(defaultRoomFee));
  const [playedAt, setPlayedAt] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const prevOpenRef = useRef(false);
  const prevInitialIdRef = useRef<number | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isEdit = Boolean(initial?.id);

  useBodyScrollLock(open);
  useFocusTrap(open && !confirmClose, dialogRef);

  // 同步外部传入的 players（AppShell 刷新后自动更新，弹窗不再自己发请求）
  useEffect(() => {
    if (players && players.length > 0) {
      setModalPlayers(players);
    }
  }, [players]);

  // 初始化表单（仅在打开弹窗或切换编辑场次时重置，避免被后台拉取玩家覆盖用户输入）
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    const initialChanged = initial?.id !== prevInitialIdRef.current;
    prevOpenRef.current = open;
    prevInitialIdRef.current = initial?.id;

    if (!open) return;
    if (!justOpened && !initialChanged) return;

    setError('');
    setSaving(false);
    setDirty(false);
    setConfirmClose(false);

    if (initial) {
      const ids = initial.records.map((r) => r.userId);
      setSelectedIds(ids);

      const rMap: Record<number, number | null> = {};
      const sMap: Record<number, 1 | -1> = {};

      initial.records.forEach((r) => {
        rMap[r.userId] = Math.abs(r.amount);
        sMap[r.userId] = r.amount < 0 ? -1 : 1;
      });

      setRawAmounts(rMap);
      setSigns(sMap);
      setRoomFee(initial.roomFee);
      setRoomFeeStr(String(initial.roomFee));

      const d = new Date(initial.playedAt);
      setPlayedAt(Number.isNaN(d.getTime()) ? toDatetimeLocalValue() : toDatetimeLocalValue(d));
      setNote(initial.note || '');
    } else {
      // 新建：默认选择活跃玩家的前 4 名
      const pool = modalPlayers.length > 0 ? modalPlayers : players;
      const activePlayers = pool.filter((p) => p.isActive !== false);
      const first4 = activePlayers.slice(0, 4).map((p) => p.id);

      setSelectedIds(first4);
      const rMap: Record<number, number | null> = {};
      const sMap: Record<number, 1 | -1> = {};
      first4.forEach((id) => {
        rMap[id] = null;
        sMap[id] = 1;
      });
      setRawAmounts(rMap);
      setSigns(sMap);
      setRoomFee(defaultRoomFee);
      setRoomFeeStr(String(defaultRoomFee));
      // 新建默认今日 14:00（上海时间），贴合傍晚开局习惯
      setPlayedAt(toTodayDatetimeLocalValue(14));
      setNote('');
    }
    // 故意不依赖 players/modalPlayers：仅在打开弹窗或切换编辑场次时重置表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultRoomFee]);

  // 计算每位玩家的带符号最终金额
  const signedAmounts = useMemo(() => {
    const map: Record<number, number | null> = {};
    for (const id of selectedIds) {
      const val = rawAmounts[id];
      if (val === null || val === undefined) {
        map[id] = null;
      } else {
        const s = signs[id] ?? 1;
        map[id] = s * val;
      }
    }
    return map;
  }, [selectedIds, rawAmounts, signs]);

  // 当前最高正分（用于皇冠预览）
  const maxPositiveScore = useMemo(() => {
    const values = selectedIds
      .map((id) => signedAmounts[id])
      .filter((v): v is number => v !== null && v !== undefined && v > 0);
    return values.length > 0 ? Math.max(...values) : 0;
  }, [selectedIds, signedAmounts]);

  const playerSum = useMemo(() => {
    return selectedIds.reduce((acc, id) => acc + (signedAmounts[id] ?? 0), 0);
  }, [selectedIds, signedAmounts]);

  const balance = playerSum + roomFee; // 应为 0
  const isBalanced = balance === 0;

  const allFilled = useMemo(
    () =>
      selectedIds.length >= 2 &&
      selectedIds.every((id) => rawAmounts[id] !== null && rawAmounts[id] !== undefined) &&
      roomFee >= 0,
    [selectedIds, rawAmounts, roomFee],
  );

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [saving, dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, requestClose]);

  function togglePlayer(id: number) {
    setDirty(true);
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id));
      setRawAmounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      setSelectedIds([...selectedIds, id]);
      setRawAmounts((prev) => ({ ...prev, [id]: null }));
      setSigns((prev) => ({ ...prev, [id]: 1 }));
    }
  }

  function setRawAmount(id: number, val: number | null) {
    setDirty(true);
    setRawAmounts((prev) => ({ ...prev, [id]: val }));
  }

  function setPlayerSign(id: number, sign: 1 | -1) {
    setDirty(true);
    setSigns((prev) => ({ ...prev, [id]: sign }));
  }

  // 一键配平指定玩家：该玩家 = -(其他人总和 + 房费)
  function balancePlayer(id: number) {
    const othersSum = selectedIds
      .filter((x) => x !== id)
      .reduce((acc, x) => acc + (signedAmounts[x] ?? 0), 0);
    const target = -(othersSum + roomFee);

    setPlayerSign(id, target < 0 ? -1 : 1);
    setRawAmount(id, Math.abs(target));
  }

  // 一键反算房费：房费 = -(所有玩家总和)
  function balanceRoomFee() {
    const fee = -playerSum;
    if (fee < 0) {
      setError('玩家合计为赢，房费不能为负——请检查各玩家输赢方向');
      return;
    }
    setError('');
    setDirty(true);
    setRoomFee(fee);
    setRoomFeeStr(String(fee));
  }

  function handleRoomFeeInput(str: string) {
    const cleaned = str.replace(/[^0-9]/g, '');
    setDirty(true);
    setRoomFeeStr(cleaned);
    setRoomFee(cleaned === '' ? 0 : parseInt(cleaned, 10));
  }

  async function handleSave() {
    setError('');
    if (!playedAt) {
      setError('请选择开局时间');
      return;
    }
    const playedAtIso = shanghaiInputToIso(playedAt);
    if (!playedAtIso) {
      setError('开局时间格式无效');
      return;
    }
    if (selectedIds.length < 2) {
      setError('每场至少需要 2 名玩家');
      return;
    }
    if (!allFilled) {
      setError('请填写所有已选玩家的输赢金额');
      return;
    }
    if (!isBalanced) {
      setError(`未配平：玩家合计 ${playerSum} + 房费 ${roomFee} = ${balance}，需为 0`);
      return;
    }

    const payload = {
      playedAt: playedAtIso,
      roomFee,
      note,
      records: selectedIds.map((id) => ({
        userId: id,
        amount: signedAmounts[id] as number,
      })),
    };

    setSaving(true);
    try {
      await apiMutate(
        isEdit ? `/api/games/${initial!.id}` : '/api/games',
        isEdit ? 'PUT' : 'POST',
        payload,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setSaving(false);
    }
  }

  if (!open) return null;

  // 本场玩家映射，若玩家已被隐藏但本场包含他，也能正常显示
  const playerMap = new Map(modalPlayers.map((p) => [p.id, p]));
  const selectedPlayers = selectedIds.map(
    (id) =>
      playerMap.get(id) || {
        id,
        nickname: `玩家 #${id}`,
        avatarColor: 'slate',
        isActive: false,
      },
  );

  // 未选玩家候选（仅显示启用中的玩家）
  const availablePlayers = modalPlayers.filter(
    (p) => p.isActive !== false && !selectedIds.includes(p.id),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={requestClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-editor-title"
        tabIndex={-1}
        className="relative w-full max-w-lg md:max-w-2xl bg-white rounded-t-3xl md:rounded-3xl max-h-[92vh] md:max-h-[88vh] flex flex-col shadow-2xl animate-slide-up outline-none"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <h2 id="game-editor-title" className="text-lg font-medium text-slate-900">
            {isEdit ? '编辑场次战绩' : '记一局'}
          </h2>
          <button
            onClick={requestClose}
            aria-label="关闭记账弹窗"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 text-slate-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 时间与备注：窄屏单列，避免 datetime 值被截断 */}
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="game-played-at"
                className="text-sm font-medium text-slate-500 mb-1 block"
              >
                开局时间
              </label>
              <input
                id="game-played-at"
                type="datetime-local"
                value={playedAt}
                onChange={(e) => {
                  setDirty(true);
                  setPlayedAt(e.target.value);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label htmlFor="game-note" className="text-sm font-medium text-slate-500 mb-1 block">
                备注
              </label>
              <input
                id="game-note"
                type="text"
                value={note}
                maxLength={MAX_GAME_NOTE_LENGTH}
                onChange={(e) => {
                  setDirty(true);
                  setNote(e.target.value);
                }}
                placeholder="如：茶楼 / 常规局"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* 选人 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-500">
                本场玩家（已选 {selectedIds.length} 人）
              </label>
              <span className="text-xs text-slate-500">至少 2 人，可随时增减</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPlayers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlayer(p.id)}
                  aria-pressed
                  aria-label={`移除 ${p.nickname}`}
                  className="flex items-center gap-1 pl-1 pr-2 py-1 rounded-full bg-slate-900 text-white text-sm font-medium"
                >
                  <PlayerAvatar nickname={p.nickname} color={p.avatarColor} size="sm" />
                  <span>{p.nickname}</span>
                  <Trash2 size={12} className="text-slate-400" />
                </button>
              ))}
              {availablePlayers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlayer(p.id)}
                  aria-pressed={false}
                  aria-label={`加入 ${p.nickname}`}
                  className="flex items-center gap-1 pl-1 pr-2 py-1 rounded-full bg-slate-100 text-slate-600 text-sm font-medium border border-dashed border-slate-300"
                >
                  <PlayerAvatar nickname={p.nickname} color={p.avatarColor} size="sm" />
                  <span>{p.nickname}</span>
                  <Plus size={12} />
                </button>
              ))}
            </div>
          </div>

          {/* 房费 */}
          <div>
            <label
              htmlFor="game-room-fee"
              className="text-sm font-medium text-slate-500 mb-1 block"
            >
              🤖 本场房费（虚拟玩家，始终赢）
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  +
                </span>
                <input
                  id="game-room-fee"
                  type="text"
                  inputMode="numeric"
                  value={roomFeeStr}
                  onChange={(e) => handleRoomFeeInput(e.target.value)}
                  aria-label="本场房费"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 text-base bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold text-amber-700 tabular-nums"
                />
              </div>
              <button
                onClick={balanceRoomFee}
                className="shrink-0 min-h-10 px-3 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium flex items-center gap-1"
              >
                <Wand2 size={13} />
                反算房费
              </button>
            </div>
          </div>

          {/* 各玩家输赢 */}
          <div className="space-y-2.5">
            <span className="text-sm font-medium text-slate-500 block">
              各玩家本场输赢（正为赢，负为输）
            </span>
            {/* 单列全宽：两列布局会把 672px 弹窗挤到每列约 311px，行内控件放不下导致横向溢出 */}
            <div className="grid grid-cols-1 gap-2.5">
              {selectedPlayers.map((p) => {
                const currentSign = signs[p.id] ?? 1;
                const rawVal = rawAmounts[p.id];
                const isFilled = rawVal !== null && rawVal !== undefined;
                const signedVal = signedAmounts[p.id];
                const isBigWinner =
                  isFilled && maxPositiveScore > 0 && signedVal === maxPositiveScore;

                return (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center gap-2.5 p-2.5 rounded-2xl border ${
                      isBigWinner
                        ? 'bg-amber-50/80 border-amber-300 ring-1 ring-amber-200'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <PlayerAvatar
                      nickname={p.nickname}
                      color={p.avatarColor}
                      size="md"
                      isBigWinner={isBigWinner}
                    />
                    <div className="flex-1 min-w-[72px]">
                      <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1">
                        <span className="truncate">{p.nickname}</span>
                        {isBigWinner && (
                          <span className="shrink-0 text-xs text-amber-600 font-medium">
                            👑大赢家
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 正负号 / 金额 / 配平：行宽不足时整体换行并右对齐 */}
                    <div className="ml-auto flex items-center gap-2">
                      <div className="flex rounded-lg overflow-hidden border border-slate-200 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPlayerSign(p.id, 1)}
                          aria-label={`${p.nickname} 本场为赢`}
                          aria-pressed={currentSign === 1}
                          className={`flex min-h-9 min-w-9 items-center justify-center text-xs font-bold transition ${
                            currentSign === 1
                              ? 'bg-red-600 text-white'
                              : 'bg-white text-slate-500 hover:text-red-500'
                          }`}
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlayerSign(p.id, -1)}
                          aria-label={`${p.nickname} 本场为输`}
                          aria-pressed={currentSign === -1}
                          className={`flex min-h-9 min-w-9 items-center justify-center text-xs font-bold transition ${
                            currentSign === -1
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white text-slate-500 hover:text-emerald-500'
                          }`}
                        >
                          <Minus size={12} />
                        </button>
                      </div>

                      {/* 绝对值金额输入 */}
                      <input
                        type="text"
                        inputMode="numeric"
                        value={rawVal === null || rawVal === undefined ? '' : String(rawVal)}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^0-9]/g, '');
                          if (cleaned === '') {
                            setRawAmount(p.id, null);
                          } else {
                            setRawAmount(p.id, parseInt(cleaned, 10));
                          }
                        }}
                        placeholder="金额"
                        aria-label={`${p.nickname} 本场金额`}
                        className={`w-20 px-2 py-1.5 rounded-lg border text-right text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                          !isFilled
                            ? 'border-slate-200 bg-white text-slate-700'
                            : currentSign === 1
                              ? 'border-red-200 bg-red-50 text-red-600'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                        }`}
                      />

                      {/* 配平此玩家 */}
                      <button
                        type="button"
                        onClick={() => balancePlayer(p.id)}
                        title="按其他人+房费自动配平"
                        aria-label={`配平 ${p.nickname}`}
                        className="shrink-0 flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-slate-200 text-slate-600 hover:bg-amber-400 hover:text-white transition"
                      >
                        <Wand2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 底部配平状态条 + 保存 */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-3 space-y-3 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}
          <div
            aria-live="polite"
            className={`flex flex-col items-start gap-1 px-4 py-2.5 rounded-xl text-sm font-medium xs:flex-row xs:items-center xs:justify-between ${
              isBalanced && allFilled
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isBalanced && allFilled ? (
                <>
                  <Check size={16} className="shrink-0" />
                  账目已配平 ✓
                </>
              ) : (
                <>
                  <Wand2 size={16} className="shrink-0" />
                  <span className="truncate">
                    {selectedIds.length < 2
                      ? '请至少选择 2 名玩家'
                      : allFilled
                        ? `还差 ${balance > 0 ? `+${balance}` : balance} 待配平`
                        : '请填完所有玩家金额'}
                  </span>
                </>
              )}
            </span>
            <span className="shrink-0 text-xs font-normal whitespace-nowrap">
              玩家合计 {playerSum > 0 ? `+${playerSum}` : playerSum} ＋ 房费 +{roomFee}
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isBalanced || !allFilled}
            className={`w-full min-h-12 rounded-2xl text-base font-medium transition ${
              isBalanced && allFilled && !saving
                ? 'bg-gradient-to-r from-amber-500 to-red-600 text-white shadow-lg active:scale-[0.99]'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            {saving ? '保存中…' : isEdit ? '保存修改' : '确认记账'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="放弃本次录入？"
        message="已填写的时间、玩家与金额不会保存。"
        confirmText="放弃"
        danger
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
