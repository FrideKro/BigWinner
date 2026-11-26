'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatSignedAmount } from '@/lib/format';

export interface TrendPoint {
  index: number;
  gameId: number;
  playedAt: string;
  dateLabel: string;
  amount: number;
  cumulativeAmount: number;
  isBigWinner: boolean;
  roomFee: number;
  note: string;
}

interface TrendChartProps {
  data: TrendPoint[];
}

const CHART_WIDTH = 340;
const CHART_HEIGHT = 170;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const PLOT_W = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

export function TrendChart({ data }: TrendChartProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(
    data.length > 0 ? data.length - 1 : null,
  );
  const svgRef = useRef<SVGSVGElement>(null);

  // 数据源切换（玩家 / 周期）时把选中点重置为最后一场，避免高亮指向已不存在的下标
  useEffect(() => {
    setSelectedIdx(data.length > 0 ? data.length - 1 : null);
  }, [data]);

  const chartGeometry = useMemo(() => {
    if (data.length === 0) return null;

    const pointsWithZero = [
      {
        index: 0,
        gameId: 0,
        playedAt: '',
        dateLabel: '起点',
        amount: 0,
        cumulativeAmount: 0,
        isBigWinner: false,
        roomFee: 0,
        note: '',
      },
      ...data,
    ];

    const values = pointsWithZero.map((p) => p.cumulativeAmount);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const span = Math.max(rawMax - rawMin, 100);
    const minVal = rawMin - span * 0.1;
    const maxVal = rawMax + span * 0.1;

    const getX = (i: number) =>
      PAD_LEFT +
      (pointsWithZero.length <= 1 ? PLOT_W / 2 : (i / (pointsWithZero.length - 1)) * PLOT_W);
    const getY = (val: number) => PAD_TOP + ((maxVal - val) / (maxVal - minVal || 1)) * PLOT_H;

    const zeroY = getY(0);
    const pathD = pointsWithZero
      .map(
        (pt, i) =>
          `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(pt.cumulativeAmount).toFixed(1)}`,
      )
      .join(' ');
    const areaD = `${pathD} L ${getX(pointsWithZero.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${getX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

    const lastValue = data[data.length - 1]?.cumulativeAmount ?? 0;
    const isPositive = lastValue >= 0;

    return {
      pointsWithZero,
      rawMin,
      rawMax,
      maxY: getY(rawMax),
      minY: getY(rawMin),
      zeroY,
      pathD,
      areaD,
      isPositive,
      strokeColor: isPositive ? '#dc2626' : '#059669',
      dense: data.length > 120,
      coords: data.map((pt, idx) => ({
        cx: getX(idx + 1),
        cy: getY(pt.cumulativeAmount),
      })),
      firstX: getX(1),
      lastX: getX(pointsWithZero.length - 1),
    };
  }, [data]);

  if (!chartGeometry) {
    return (
      <div className="h-44 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        当前周期暂无参赛记录
      </div>
    );
  }

  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const padLeft = PAD_LEFT;
  const padRight = PAD_RIGHT;
  const plotW = PLOT_W;
  const {
    rawMin,
    rawMax,
    maxY,
    minY,
    zeroY,
    pathD,
    areaD,
    isPositive,
    strokeColor,
    dense,
    coords,
    firstX,
    lastX,
  } = chartGeometry;

  const activePoint =
    selectedIdx !== null && data[selectedIdx] ? data[selectedIdx] : data[data.length - 1];

  // 在折线上按横坐标就近选中，支持手指横向拖动查看每一场；索引未变时不触发重渲染
  function selectNearest(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((clientX - rect.left) / rect.width) * width;
    const ratio = (x - padLeft) / plotW;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(ratio * data.length) - 1));
    setSelectedIdx((prev) => (prev === idx ? prev : idx));
  }

  return (
    <div className="space-y-2.5">
      {/* 选中节点详情条 */}
      {activePoint && (
        <div
          aria-live="polite"
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs"
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-amber-400 font-medium whitespace-nowrap">
              第{activePoint.index}场 ({activePoint.dateLabel})
            </span>
            {activePoint.isBigWinner && (
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs">
                👑大赢家
              </span>
            )}
            {activePoint.note && (
              <span className="text-slate-400 truncate max-w-[90px]">· {activePoint.note}</span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span>
              本场:{' '}
              <b className={activePoint.amount >= 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {formatSignedAmount(activePoint.amount)}
              </b>
            </span>
            <span>
              累计:{' '}
              <b
                className={
                  activePoint.cumulativeAmount >= 0 ? 'text-amber-300' : 'text-emerald-400'
                }
              >
                {formatSignedAmount(activePoint.cumulativeAmount)}
              </b>
            </span>
          </div>
        </div>
      )}

      <div className="relative w-full overflow-hidden bg-slate-50/80 rounded-xl border border-slate-100 p-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none touch-pan-y"
          role="img"
          aria-label="资金累计盈亏走势曲线，可左右拖动查看每场"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            selectNearest(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            selectNearest(e.clientX);
          }}
        >
          <defs>
            <linearGradient id="trendGradRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="trendGradGreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.24" />
            </linearGradient>
          </defs>

          {/* 最高/最低参考线 */}
          <line
            x1={padLeft}
            y1={maxY}
            x2={width - padRight}
            y2={maxY}
            stroke="#e2e8f0"
            strokeDasharray="2 2"
            strokeWidth="1"
          />
          <text
            x={padLeft - 5}
            y={maxY + 3}
            textAnchor="end"
            className="fill-slate-500 text-[11px]"
          >
            {rawMax > 0 ? `+${rawMax}` : rawMax}
          </text>

          {rawMin < 0 && (
            <>
              <line
                x1={padLeft}
                y1={minY}
                x2={width - padRight}
                y2={minY}
                stroke="#e2e8f0"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <text
                x={padLeft - 5}
                y={minY + 3}
                textAnchor="end"
                className="fill-slate-500 text-[11px]"
              >
                {rawMin}
              </text>
            </>
          )}

          {/* 0 基准线 */}
          <line
            x1={padLeft}
            y1={zeroY}
            x2={width - padRight}
            y2={zeroY}
            stroke="#94a3b8"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
          <text
            x={padLeft - 5}
            y={zeroY + 3}
            textAnchor="end"
            className="fill-slate-600 text-[11px] font-medium"
          >
            0
          </text>

          {/* 面积填充 */}
          <path d={areaD} fill={isPositive ? 'url(#trendGradRed)' : 'url(#trendGradGreen)'} />

          {/* 折线主体 */}
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 数据点：长序列只保留大赢家与当前选中点，避免 DOM 过密 */}
          {data.map((pt, idx) => {
            const { cx, cy } = coords[idx];
            const isSelected = (selectedIdx ?? data.length - 1) === idx;
            if (dense && !pt.isBigWinner && !isSelected) return null;
            return (
              <g key={pt.gameId} className="cursor-pointer" onClick={() => setSelectedIdx(idx)}>
                <circle cx={cx} cy={cy} r={16} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5 : pt.isBigWinner ? 4 : 3}
                  fill={
                    pt.isBigWinner ? '#f59e0b' : pt.cumulativeAmount >= 0 ? '#dc2626' : '#059669'
                  }
                  stroke="#ffffff"
                  strokeWidth={isSelected ? 2 : 1.5}
                />
              </g>
            );
          })}

          {/* 首尾日期标签 */}
          <text x={firstX} y={height - 6} textAnchor="start" className="fill-slate-500 text-[11px]">
            {data[0]?.dateLabel}
          </text>
          {data.length > 1 && (
            <text x={lastX} y={height - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
              {data[data.length - 1]?.dateLabel}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
