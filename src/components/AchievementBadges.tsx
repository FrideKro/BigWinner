'use client';

import React from 'react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ACHIEVEMENT_META, type Achievement, type AchievementType } from '@/app/api/_lib/statsAgg';

// 成就展示组件：数据由 /api/stats 与 /api/s/[code] 共享统计层实时推导，本组件无状态

/** 成就数值展示：纯数字大字，连胜的中文单位弱化为小字，半宽卡片内给昵称留足空间 */
function AchievementValue({ type, value }: { type: AchievementType; value: number }) {
  return (
    <span className="shrink-0 text-lg font-black text-red-600 tabular-nums">
      {type === 'MAX_SINGLE_WIN' ? (
        `+${value}`
      ) : (
        <>
          {value}
          <span className="text-xs font-medium text-slate-500 ml-0.5">连胜</span>
        </>
      )}
    </span>
  );
}

/** 双卡成就条：单场最高 / 最长连胜的全群纪录保持者（可并列），布局参照头号赢家卡片 */
export function AchievementsStrip({
  achievements,
  getAvatarImage,
}: {
  achievements: Achievement[];
  /** userId → 自定义头像图片；不传或返回 null 时落字母主题色头像 */
  getAvatarImage?: (userId: number) => string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {achievements.map((a) => {
        const meta = ACHIEVEMENT_META[a.type];
        if (a.holders.length === 0) {
          // 虚位以待：参照头号赢家空态，虚线圆占位
          return (
            <div
              key={a.type}
              className="p-3 rounded-2xl bg-white border border-amber-100 shadow-sm flex items-center gap-2.5"
            >
              <div className="w-12 h-12 shrink-0 rounded-full bg-amber-50 border border-dashed border-amber-200 flex items-center justify-center text-xl">
                {meta.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-amber-600 truncate">{meta.name}</div>
                <div className="text-sm text-slate-400 mt-0.5 truncate">虚位以待</div>
              </div>
            </div>
          );
        }
        return (
          <div
            key={a.type}
            className="p-3 rounded-2xl bg-white border border-amber-100 shadow-sm space-y-2"
          >
            {a.holders.map((h) => (
              <div key={h.userId} className="flex items-center gap-2.5 min-w-0">
                <PlayerAvatar
                  nickname={h.nickname}
                  color={h.avatarColor}
                  size="md"
                  src={getAvatarImage?.(h.userId) ?? null}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-amber-600 truncate">{meta.name}</div>
                  <div className="text-base text-slate-900 mt-0.5 truncate">{h.nickname}</div>
                </div>
                <AchievementValue type={a.type} value={h.value} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 玩家个人成就徽章行：按 userId 过滤持有的成就（单人可同时占两项），无持有则不渲染 */
export function PlayerAchievementBadges({
  achievements,
  userId,
}: {
  achievements: Achievement[];
  userId: number;
}) {
  const owned = achievements.filter((a) => a.holders.some((h) => h.userId === userId));
  if (owned.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {owned.map((a) => (
        <span
          key={a.type}
          className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700 flex items-center gap-1"
        >
          <span className="leading-none">{ACHIEVEMENT_META[a.type].icon}</span>
          <span>{ACHIEVEMENT_META[a.type].name}</span>
        </span>
      ))}
    </div>
  );
}
