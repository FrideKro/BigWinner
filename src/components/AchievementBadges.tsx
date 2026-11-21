'use client';

import React from 'react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ACHIEVEMENT_META, type Achievement, type AchievementType } from '@/app/api/_lib/statsAgg';

// 成就展示组件：数据由 /api/stats 与 /api/s/[code] 共享统计层实时推导，本组件无状态

/** 成就数值展示：单场最高 +N（红=赢），连胜 N 连胜 */
function achievementValueText(type: AchievementType, value: number): string {
  return type === 'MAX_SINGLE_WIN' ? `+${value}` : `${value} 连胜`;
}

/** 双卡成就条：单场最高 / 连胜场次的全群纪录保持者（可并列），无纪录时虚位以待 */
export function AchievementsStrip({ achievements }: { achievements: Achievement[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {achievements.map((a) => {
        const meta = ACHIEVEMENT_META[a.type];
        return (
          <div
            key={a.type}
            className="p-3 rounded-2xl bg-white border border-amber-100 shadow-sm space-y-2"
          >
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <span className="text-base leading-none">{meta.icon}</span>
              <span>{meta.name}</span>
            </div>
            {a.holders.length === 0 ? (
              <div className="text-xs text-slate-400 py-1.5">虚位以待</div>
            ) : (
              <div className="space-y-1.5">
                {a.holders.map((h) => (
                  <div key={h.userId} className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar nickname={h.nickname} color={h.avatarColor} size="sm" />
                    <span className="text-sm text-slate-700 truncate">{h.nickname}</span>
                    <span className="ml-auto shrink-0 text-sm font-black text-red-600 tabular-nums">
                      {achievementValueText(a.type, h.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
