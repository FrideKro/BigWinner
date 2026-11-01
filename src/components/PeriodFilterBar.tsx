'use client';

import React from 'react';
import { currentShanghaiDate } from '@/lib/gameLogic';

// 时间周期筛选值：固定周期（全部/本年/本月）或自定义日期区间（上海时区自然日，含结束当天）
export type PeriodFilterValue =
  | { kind: 'all' }
  | { kind: 'year' }
  | { kind: 'month' }
  | { kind: 'range'; from: string; to: string };

const OPTIONS = [
  { kind: 'all', label: '全部' },
  { kind: 'year', label: '本年' },
  { kind: 'month', label: '本月' },
  { kind: 'range', label: '自定义' },
] as const;

/** 筛选值 → API 查询参数片段（period=... 或 from=...&to=...），由各页面拼进请求 URL */
export function periodFilterQuery(value: PeriodFilterValue): string {
  if (value.kind === 'range') {
    return `from=${encodeURIComponent(value.from)}&to=${encodeURIComponent(value.to)}`;
  }
  return `period=${value.kind}`;
}

// sessionStorage 键：AppShell 据此在会话内（含页面刷新）记忆筛选选择
export const PERIOD_FILTER_STORAGE_KEY = 'bw_period_filter';

/** 从 sessionStorage 原文解析记忆的筛选值；缺失 / 损坏 / 形状非法一律回退「全部」 */
export function parseStoredPeriodFilter(raw: string | null): PeriodFilterValue {
  if (!raw) return { kind: 'all' };
  try {
    const parsed = JSON.parse(raw) as PeriodFilterValue;
    if (parsed.kind === 'range') {
      const from = typeof parsed.from === 'string' ? parsed.from : '';
      const to = typeof parsed.to === 'string' ? parsed.to : '';
      // 起止需为合法日期形状且 from ≤ to，与组件的收口语义一致
      if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
        return { kind: 'range', from, to };
      }
      return { kind: 'all' };
    }
    if (parsed.kind === 'all' || parsed.kind === 'year' || parsed.kind === 'month') {
      return { kind: parsed.kind };
    }
    return { kind: 'all' };
  } catch {
    return { kind: 'all' };
  }
}

/** 自定义区间的默认值：前天 ~ 上海今天（Date.UTC 自动处理跨月/跨年进位） */
export function defaultCustomRange(today = currentShanghaiDate()): { from: string; to: string } {
  const [year, month, day] = today.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, day - 2)).toISOString().slice(0, 10),
    to: today,
  };
}

interface PeriodFilterBarProps {
  value: PeriodFilterValue;
  onChange: (value: PeriodFilterValue) => void;
}

// 总榜 / 流水 / 看板共用的时间周期筛选条：四个选项 + 自定义时展开起止日期。
// 日期变更时自动收口保证 from ≤ to，任何状态下向外抛出的都是合法区间
export function PeriodFilterBar({ value, onChange }: PeriodFilterBarProps) {
  const isRange = value.kind === 'range';

  function selectKind(kind: PeriodFilterValue['kind']) {
    if (kind === 'range') {
      // 从固定周期切入自定义时给默认区间（前天 ~ 今天）；已是自定义不动
      if (!isRange) {
        onChange({ kind: 'range', ...defaultCustomRange() });
      }
      return;
    }
    onChange({ kind });
  }

  // 清空日期输入时忽略（受控值弹回），避免向外抛出不完整区间
  function changeRange(part: 'from' | 'to', day: string) {
    if (!day || value.kind !== 'range') return;
    if (part === 'from') {
      // 开始日越过结束日时同步收口，保持区间恒合法
      onChange({ kind: 'range', from: day, to: day > value.to ? day : value.to });
    } else {
      onChange({ kind: 'range', from: day < value.from ? day : value.from, to: day });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 p-1 bg-slate-200/80 rounded-2xl">
        {OPTIONS.map((item) => {
          const selected = isRange ? item.kind === 'range' : value.kind === item.kind;
          return (
            <button
              key={item.kind}
              type="button"
              onClick={() => selectKind(item.kind)}
              aria-pressed={selected}
              className={`flex-1 min-h-10 py-1.5 text-sm font-medium rounded-xl transition ${
                selected
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {value.kind === 'range' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => changeRange('from', e.target.value)}
            aria-label="开始日期"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <input
            type="date"
            value={value.to}
            min={value.from}
            onChange={(e) => changeRange('to', e.target.value)}
            aria-label="结束日期"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      )}
    </div>
  );
}
