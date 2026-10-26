import React, { useId } from 'react';

/**
 * 大赢家品牌 Logo：🀄 款式——白色麻将牌 + 正中红「中」
 * 宽牌身 + 侧面厚度 / 明暗渐变 / 倒角亮线，模拟实物立体感
 * 与 src/app/icon.svg（favicon）保持同一设计，改动请两处同步
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
  const faceId = `bw-lg-face-${uid}`;
  const sideId = `bw-lg-side-${uid}`;
  const sheenId = `bw-lg-sheen-${uid}`;
  const contactId = `bw-lg-contact-${uid}`;
  const zhongId = `bw-lg-zhong-${uid}`;
  const shadowId = `bw-lg-shadow-${uid}`;
  const clipId = `bw-lg-clip-${uid}`;

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
        <linearGradient id={faceId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#fffefb" />
          <stop offset="0.55" stopColor="#f5f1e4" />
          <stop offset="1" stopColor="#e5dec8" />
        </linearGradient>
        <linearGradient id={sideId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8cfb8" />
          <stop offset="1" stopColor="#ada17f" />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={contactId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b5c3d" stopOpacity="0" />
          <stop offset="1" stopColor="#6b5c3d" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={zhongId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e23430" />
          <stop offset="1" stopColor="#c81e1e" />
        </linearGradient>
        <filter
          id={shadowId}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="10"
            floodColor="#0f172a"
            floodOpacity="0.3"
          />
        </filter>
        <clipPath id={clipId}>
          <rect x="86" y="32" width="340" height="428" rx="50" />
        </clipPath>
      </defs>

      {/* 牌影（本体被牌面覆盖，仅投影可见） */}
      <g filter={`url(#${shadowId})`}>
        <rect x="86" y="32" width="340" height="428" rx="50" fill="#0f172a" />
      </g>

      {/* 牌侧面（厚度 18px，上亮下暗） */}
      <rect
        x="86"
        y="50"
        width="340"
        height="428"
        rx="50"
        fill={`url(#${sideId})`}
      />

      {/* 牌面 */}
      <rect
        x="86"
        y="32"
        width="340"
        height="428"
        rx="50"
        fill={`url(#${faceId})`}
        stroke="#c9c1ab"
        strokeWidth="5"
      />

      {/* 牌面光泽（顶部）与底部接触阴影 */}
      <g clipPath={`url(#${clipId})`}>
        <rect x="86" y="32" width="340" height="170" fill={`url(#${sheenId})`} />
        <rect
          x="86"
          y="340"
          width="340"
          height="120"
          fill={`url(#${contactId})`}
        />
      </g>

      {/* 内倒角亮线 */}
      <rect
        x="94"
        y="40"
        width="324"
        height="412"
        rx="43"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.5"
        strokeWidth="3"
      />

      {/* 红中（左竖 / 镂空 / 竖笔 / 镂空 / 右竖） */}
      <g fill={`url(#${zhongId})`}>
        <rect x="151" y="146" width="210" height="46" rx="6" />
        <rect x="151" y="248" width="210" height="46" rx="6" />
        <rect x="151" y="146" width="46" height="148" rx="6" />
        <rect x="315" y="146" width="46" height="148" rx="6" />
        <rect x="233" y="86" width="46" height="320" rx="8" />
      </g>
    </svg>
  );
}
