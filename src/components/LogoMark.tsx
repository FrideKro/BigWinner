import React, { useId } from 'react';

/**
 * 大赢家品牌 Logo：举杯欢聚——三杯相碰溅星 + 六人群像，前排冠军红衣金冠
 * 深蓝黑底圆角徽章 + 金色渐变，延续黑金榜单卡片视觉；红＝赢
 * 与 src/app/icon.svg（favicon/PWA）保持同一设计，改动请两处同步
 */
export function LogoMark({
  size = 32,
  className = '',
}: {
  /** 渲染尺寸（px），可用 Tailwind 宽高类覆盖 */
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bgId = `bw-lg-bg-${uid}`;
  const goldId = `bw-lg-gold-${uid}`;

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden={true}
      focusable={false}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="0.55" stopColor="#101a30" />
          <stop offset="1" stopColor="#241b10" />
        </linearGradient>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${bgId})`} />

      {/* 碰杯的金杯群：中杯直立，左右两杯倾向中央 */}
      <g fill={`url(#${goldId})`}>
        <g transform="translate(256 148) scale(0.72)">
          <path d="M-52 -42 h104 l-14 64 a34 34 0 0 1 -76 0 z" />
          <rect x="-8" y="10" width="16" height="52" rx="6" />
          <rect x="-36" y="62" width="72" height="13" rx="6.5" />
        </g>
        <g transform="translate(186 172) rotate(22) scale(0.62)">
          <path d="M-52 -42 h104 l-14 64 a34 34 0 0 1 -76 0 z" />
          <rect x="-8" y="10" width="16" height="52" rx="6" />
          <rect x="-36" y="62" width="72" height="13" rx="6.5" />
        </g>
        <g transform="translate(326 172) rotate(-22) scale(0.62)">
          <path d="M-52 -42 h104 l-14 64 a34 34 0 0 1 -76 0 z" />
          <rect x="-8" y="10" width="16" height="52" rx="6" />
          <rect x="-36" y="62" width="72" height="13" rx="6.5" />
        </g>
      </g>

      {/* 碰杯溅出的星点 */}
      <g fill="#fef3c7">
        <circle cx="256" cy="84" r="11" />
        <circle cx="216" cy="66" r="6.5" />
        <circle cx="296" cy="66" r="6.5" />
        <circle cx="256" cy="46" r="5" />
      </g>

      {/* 后排三名好友（仅探头，深色） */}
      <g fill="#475569">
        <circle cx="168" cy="286" r="24" />
        <path d="M136 352 a32 32 0 0 1 64 0 z" />
        <circle cx="256" cy="264" r="24" />
        <path d="M224 330 a32 32 0 0 1 64 0 z" />
        <circle cx="344" cy="286" r="24" />
        <path d="M312 352 a32 32 0 0 1 64 0 z" />
      </g>

      {/* 前排两侧好友（浅色） */}
      <g fill="#94a3b8">
        <circle cx="92" cy="376" r="26" />
        <path d="M50 476 a42 42 0 0 1 84 0 z" />
        <circle cx="420" cy="376" r="26" />
        <path d="M378 476 a42 42 0 0 1 84 0 z" />
      </g>

      {/* 前排冠军：红衣（红＝赢），头顶金冠 */}
      <g>
        <circle cx="256" cy="378" r="32" fill="#ef4444" />
        <path d="M200 476 a56 56 0 0 1 112 0 z" fill="#ef4444" />
        <g fill={`url(#${goldId})`}>
          <path d="M218 340 l-9 -32 24 14 11 -22 11 22 24 -14 -9 32 z" />
          <rect x="216" y="340" width="80" height="12" rx="6" />
        </g>
      </g>
    </svg>
  );
}
