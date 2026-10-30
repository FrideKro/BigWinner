'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Copy, Trash2, Link2, Trophy, ListOrdered, BarChart3 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { CopyFallbackModal } from './CopyFallbackModal';
import { useApp } from './AppShell';
import { ErrorState } from './ErrorState';
import { apiGet, apiMutate } from '@/lib/apiClient';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useCopyText } from '@/lib/useCopyText';
import { formatDateTime, shareExpiryEndDay } from '@/lib/format';

const SCOPE_OPTIONS = [
  { key: 'board', label: '总榜', icon: Trophy },
  { key: 'games', label: '流水', icon: ListOrdered },
  { key: 'stats', label: '看板', icon: BarChart3 },
] as const;

const EXPIRY_KINDS = [
  { key: 'today', label: '今天' },
  { key: 'custom', label: '自定义' },
  { key: 'never', label: '永久' },
] as const;

// 自定义有效期上限（与服务端 MAX_SHARE_EXPIRY_DAYS 一致），用于日期控件 max
const MAX_EXPIRY_DAYS = 365;

interface ShareListItem {
  id: number;
  code: string;
  contentScope: string[];
  periodType: 'period' | 'range';
  period: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  periodLabel: string;
  expiresAt: string | null;
  createdAt: string;
}

interface ShareModalProps {
  open: boolean;
  /** 打开时的预填周期（总榜页当前所选：all / year / month / YYYY-MM） */
  initialPeriod?: string;
  /** 可选的具体月份列表（来自总榜页 summary） */
  availableMonths?: string[];
  onClose: () => void;
}

// 上海时区当天 YYYY-MM-DD（date 控件与分享区间同用自然日语义）
function shanghaiTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

// 上海「今天」+ N 天的日历日（Date.UTC 自动进位）
function shanghaiDateAfterDays(days: number): string {
  const [year, month, day] = shanghaiTodayDate().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function shareUrl(code: string): string {
  return `${window.location.origin}/s/${code}`;
}

// 有效期按上海自然日计：剩余天数 = 末自然日 − 今天（日历日差，不看时分）
function expiryText(item: ShareListItem): string {
  if (!item.expiresAt) return '永久有效';
  if (new Date(item.expiresAt).getTime() <= Date.now()) return '已过期';
  const endDay = shareExpiryEndDay(item.expiresAt);
  const days = Math.round(
    (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${shanghaiTodayDate()}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return '今天到期';
  if (days === 1) return '明天到期';
  return `剩 ${days} 天有效`;
}

function scopeLabel(keys: string[]): string {
  return keys.map((k) => SCOPE_OPTIONS.find((o) => o.key === k)?.label || k).join(' · ');
}

export function ShareModal({ open, initialPeriod, availableMonths, onClose }: ShareModalProps) {
  const { showToast } = useApp();

  // 创建表单
  const [scopes, setScopes] = useState<string[]>(['board']);
  const [periodKind, setPeriodKind] = useState<'all' | 'year' | 'month' | 'custom'>('all');
  const [monthValue, setMonthValue] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [expiryKind, setExpiryKind] = useState<'today' | 'custom' | 'never'>('today');
  const [expiryDate, setExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 表单是否被修改过：修改后点遮罩/关闭按钮需二次确认，防止误触丢已填设置
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // 创建成功横幅
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copiedNew, setCopiedNew] = useState(false);

  // 已创建分享列表
  const [shares, setShares] = useState<ShareListItem[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShareListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { copy, fallback, clearFallback } = useCopyText();
  const prevOpenRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(open);
  useFocusTrap(open, dialogRef);

  // 打开弹窗时重置表单（预填当前周期）并加载已创建的分享
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;

    setError('');
    setSaving(false);
    setCreatedUrl(null);
    setCopiedNew(false);
    setDirty(false);
    setConfirmDiscard(false);
    setScopes(['board']);

    const period = initialPeriod || 'all';
    if (period === 'year') {
      setPeriodKind('year');
      setMonthValue('');
    } else if (/^\d{4}-\d{2}$/.test(period)) {
      setPeriodKind('month');
      setMonthValue(period);
    } else {
      setPeriodKind('all');
      setMonthValue('');
    }
    const today = shanghaiTodayDate();
    setRangeStart(`${today.slice(0, 7)}-01`);
    setRangeEnd(today);
    setExpiryKind('today');
    setExpiryDate(shanghaiDateAfterDays(7));
    // 故意不依赖 initialPeriod/availableMonths：仅打开瞬间重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 已创建分享列表：每次 open 变为 true 都重新拉取。
  // 不与上方表单重置共用 effect（StrictMode 双跑时首次异步回调会被 cleanup 作废，
  // 而此处每次 effect 都重新发请求，避免骨架卡死）
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSharesLoading(true);
    setSharesError('');
    apiGet<{ shares: ShareListItem[] }>('/api/shares', { force: true })
      .then((data) => {
        if (active) setShares(data.shares || []);
      })
      .catch((err) => {
        if (active) setSharesError(err instanceof Error ? err.message : '加载失败，请稍后重试');
      })
      .finally(() => {
        if (active) setSharesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  function toggleScope(key: string) {
    setDirty(true);
    setScopes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // 遮罩/关闭按钮的统一出口：表单已修改时先确认，避免误触丢失已填设置
  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function refreshShares() {
    const data = await apiGet<{ shares: ShareListItem[] }>('/api/shares', { force: true });
    setShares(data.shares || []);
  }

  async function handleCreate() {
    setError('');
    if (scopes.length === 0) {
      setError('请至少选择一个分享内容');
      return;
    }
    if (periodKind === 'month' && !monthValue) {
      setError('请选择具体月份');
      return;
    }
    if (periodKind === 'custom') {
      if (!rangeStart || !rangeEnd) {
        setError('请选择自定义时间段的起止日期');
        return;
      }
      if (rangeEnd < rangeStart) {
        setError('结束日期不能早于开始日期');
        return;
      }
    }
    if (expiryKind === 'custom' && !expiryDate) {
      setError('请选择有效期日期');
      return;
    }
    if (expiryKind === 'custom' && expiryDate < shanghaiTodayDate()) {
      setError('有效期不能早于今天');
      return;
    }

    // 有效期：今天 → 上海今天；自定义 → 所选日；永久 → null（均含当天，至当天 24:00）
    const expiresOn =
      expiryKind === 'today' ? shanghaiTodayDate() : expiryKind === 'custom' ? expiryDate : null;

    setSaving(true);
    try {
      const created =
        periodKind === 'custom'
          ? await apiMutate<{ code: string }>('/api/shares', 'POST', {
              contentScope: scopes,
              periodType: 'range',
              rangeStart,
              rangeEnd,
              expiresOn,
            })
          : await apiMutate<{ code: string }>('/api/shares', 'POST', {
              contentScope: scopes,
              periodType: 'period',
              period: periodKind === 'month' ? monthValue : periodKind,
              expiresOn,
            });
      setCreatedUrl(shareUrl(created.code));
      setDirty(false); // 表单已消费，关闭无需再确认
      await refreshShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  // 复制成功点亮按钮 2 秒；失败时 useCopyText 自动弹出长按复制兜底层
  async function handleCopyUrl(url: string, itemId?: number) {
    const ok = await copy(url);
    if (!ok) return;
    if (itemId !== undefined) {
      setCopiedId(itemId);
      setTimeout(() => setCopiedId((cur) => (cur === itemId ? null : cur)), 2000);
    } else {
      setCopiedNew(true);
      setTimeout(() => setCopiedNew(false), 2000);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiMutate(`/api/shares/${deleteTarget.id}`, 'DELETE');
      setShares((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      showToast('分享已删除');
      setDeleteTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={requestClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        tabIndex={-1}
        className="relative w-full max-w-lg bg-white rounded-t-3xl md:rounded-3xl max-h-[92vh] md:max-h-[88vh] flex flex-col shadow-2xl animate-slide-up outline-none"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <h2
            id="share-modal-title"
            className="flex items-center gap-1.5 text-lg font-medium text-slate-900"
          >
            <Link2 size={18} className="text-amber-500" />
            分享战报
          </h2>
          <button
            onClick={requestClose}
            aria-label="关闭分享弹窗"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100 text-slate-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 创建成功横幅 */}
          {createdUrl && (
            <div
              className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 space-y-2"
              role="status"
            >
              <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Check size={15} className="shrink-0" />
                分享链接已生成，复制发到群里即可
              </div>
              <div className="text-xs text-slate-600 bg-white rounded-lg px-2.5 py-2 break-all">
                {createdUrl}
              </div>
              <button
                onClick={() => handleCopyUrl(createdUrl)}
                className="w-full min-h-10 rounded-xl bg-slate-900 text-white text-sm font-medium active:scale-[0.99] transition flex items-center justify-center gap-1.5"
              >
                {copiedNew ? (
                  <>
                    <Check size={14} className="text-emerald-400" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    复制链接
                  </>
                )}
              </button>
            </div>
          )}

          {/* 分享内容 */}
          <div>
            <span className="text-sm font-medium text-slate-500 mb-1.5 block">分享内容</span>
            <div className="grid grid-cols-3 gap-2">
              {SCOPE_OPTIONS.map((o) => {
                const selected = scopes.includes(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => toggleScope(o.key)}
                    aria-pressed={selected}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-2xl border text-sm font-medium transition ${
                      selected
                        ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <o.icon size={16} />
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 时间段 */}
          <div>
            <span className="text-sm font-medium text-slate-500 mb-1.5 block">时间段</span>
            <div className="flex items-center gap-1 p-1 bg-slate-200/60 rounded-xl">
              {[
                { key: 'all', label: '全部' },
                { key: 'year', label: '本年' },
                { key: 'custom', label: '自定义' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setDirty(true);
                    setPeriodKind(item.key as typeof periodKind);
                  }}
                  aria-pressed={periodKind === item.key}
                  className={`flex-1 min-h-9 py-1 rounded-lg text-sm font-medium transition ${
                    periodKind === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <select
                aria-label="选择月份"
                value={periodKind === 'month' ? monthValue : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setDirty(true);
                    setPeriodKind('month');
                    setMonthValue(e.target.value);
                  }
                }}
                className={`min-h-9 py-1 px-1.5 text-sm font-medium rounded-lg border-none focus:outline-none transition ${
                  periodKind === 'month'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'bg-transparent text-slate-600'
                }`}
              >
                <option value="">月份…</option>
                {(availableMonths || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {periodKind === 'custom' && (
              <>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    type="date"
                    value={rangeStart}
                    max={rangeEnd || undefined}
                    onChange={(e) => {
                      setDirty(true);
                      setRangeStart(e.target.value);
                    }}
                    aria-label="开始日期"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <input
                    type="date"
                    value={rangeEnd}
                    min={rangeStart || undefined}
                    onChange={(e) => {
                      setDirty(true);
                      setRangeEnd(e.target.value);
                    }}
                    aria-label="结束日期"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">按上海时区自然日，含结束当天</p>
              </>
            )}
          </div>

          {/* 有效期 */}
          <div>
            <span className="text-sm font-medium text-slate-500 mb-1.5 block">有效期</span>
            <div className="grid grid-cols-3 gap-1.5">
              {EXPIRY_KINDS.map((o) => {
                const selected = expiryKind === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setDirty(true);
                      setExpiryKind(o.key);
                    }}
                    aria-pressed={selected}
                    className={`py-2 rounded-xl border text-sm font-medium transition ${
                      selected
                        ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {expiryKind === 'custom' && (
              <input
                type="date"
                value={expiryDate}
                min={shanghaiTodayDate()}
                max={shanghaiDateAfterDays(MAX_EXPIRY_DAYS)}
                onChange={(e) => {
                  setDirty(true);
                  setExpiryDate(e.target.value);
                }}
                aria-label="有效期至"
                className="w-full mt-2 px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            )}
            <p className="text-xs text-slate-500 mt-1.5">按自然日计算，至所选当天 24:00 失效</p>
          </div>

          {/* 已创建的分享 */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-sm font-medium text-slate-500">已创建的分享</h3>
              <span className="text-xs text-slate-400">最近 20 条</span>
            </div>
            {sharesError ? (
              <ErrorState
                message={sharesError}
                onRetry={() => refreshShares().catch(() => undefined)}
                compact
              />
            ) : sharesLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="加载分享列表中">
                {[1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : shares.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
                暂无分享链接
              </div>
            ) : (
              <div className="space-y-2">
                {shares.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {item.periodLabel} · {scopeLabel(item.contentScope)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {expiryText(item)} · 创建于 {formatDateTime(item.createdAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCopyUrl(shareUrl(item.code), item.id)}
                      aria-label="复制分享链接"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                        copiedId === item.id
                          ? 'text-emerald-600'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {copiedId === item.id ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      aria-label="删除分享"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部生成按钮 */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-3 space-y-3 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && (
            <div
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={saving}
            className={`w-full min-h-12 rounded-2xl text-base font-medium transition ${
              saving
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-slate-900 text-white active:scale-[0.99]'
            }`}
          >
            {saving ? '生成中…' : '生成分享链接'}
          </button>
        </div>
      </div>

      <CopyFallbackModal text={fallback} onClose={clearFallback} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除该分享链接？"
        message={
          deleteTarget
            ? `「${deleteTarget.periodLabel}」的分享删除后立即失效，已打开的页面将无法再查看。`
            : ''
        }
        confirmText="删除"
        danger
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        title="放弃当前分享设置？"
        message="关闭后本次填写的分享内容与时间段将不会保留。"
        confirmText="放弃并关闭"
        busy={saving}
        onConfirm={() => {
          setConfirmDiscard(false);
          setDirty(false);
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
