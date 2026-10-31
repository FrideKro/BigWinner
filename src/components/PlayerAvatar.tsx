'use client';

import React from 'react';
import { getAvatarTheme } from '@/lib/format';

interface PlayerAvatarProps {
  nickname: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  isBigWinner?: boolean;
  rank?: number;
  /** 自定义头像图片（base64 data URL）；无图时落昵称首字 + 主题色 */
  src?: string | null;
}

// 各尺寸的容器与字号；3 个字比 2 个字宽约 50%，需缩字号（sm 还要加大容器）避免溢出圆形
const SIZE_STYLES = {
  sm: { normal: 'w-8 h-8 text-xs', wide: 'w-9 h-9 text-xs' },
  md: { normal: 'w-10 h-10 text-sm', wide: 'w-10 h-10 text-xs' },
  lg: { normal: 'w-12 h-12 text-base', wide: 'w-12 h-12 text-sm' },
} as const;

function PlayerAvatarInner({
  nickname,
  color = 'red',
  size = 'md',
  isBigWinner = false,
  rank,
  src,
}: PlayerAvatarProps) {
  const theme = getAvatarTheme(color);
  const label = Array.from((nickname || '友').trim())
    .slice(0, 3)
    .join('');
  // 图片头像不用按 3 字缩字号的 wide 档
  const sizeClass = SIZE_STYLES[size][!src && label.length >= 3 ? 'wide' : 'normal'];

  return (
    <div className="relative inline-flex items-center justify-center shrink-0">
      <div
        className={`${sizeClass} ${theme.bg} ${theme.text} rounded-full font-medium flex items-center justify-center shadow-sm ring-2 ${theme.ring} overflow-hidden`}
      >
        {src ? (
          // 头像为前端压缩后的 base64 data URL（几 KB），next/image 无优化空间
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`${nickname}的头像`}
            className="h-full w-full rounded-full object-cover"
            draggable={false}
          />
        ) : (
          label
        )}
      </div>
      {isBigWinner && (
        <span
          className="absolute -top-2 -right-1.5 text-sm leading-none drop-shadow"
          title="当场大赢家"
        >
          👑
        </span>
      )}
      {typeof rank === 'number' && rank >= 1 && rank <= 3 && !isBigWinner && (
        <span className="absolute -bottom-1 -right-1 text-xs leading-none">
          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
        </span>
      )}
    </div>
  );
}

export const PlayerAvatar = React.memo(PlayerAvatarInner);
