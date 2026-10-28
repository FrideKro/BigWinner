import React, { useId } from 'react';

/**
 * 大赢家品牌 Logo：四方围桌 · 牌局赢家
 * 金色圆桌光环象征台面零和闭环，四席好友环绕（北席大赢家红、南席绿、东西银白，呼应红赢绿输），
 * 圆桌中央立起三尖黄金皇冠
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
  const tableId = `bw-lg-table-${uid}`;
  const goldId = `bw-lg-gold-${uid}`;
  const redId = `bw-lg-red-${uid}`;
  const greenId = `bw-lg-green-${uid}`;

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
          <stop offset="0.55" stopColor="#131c33" />
          <stop offset="1" stopColor="#241812" />
        </linearGradient>
        <radialGradient id={tableId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </radialGradient>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="0.45" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={redId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="0.4" stopColor="#ef4444" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id={greenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${bgId})`} />

      {/* 牌局圆桌金环（代表好友围桌与零和配平闭环） */}
      <circle
        cx="256"
        cy="256"
        r="158"
        fill={`url(#${tableId})`}
        stroke={`url(#${goldId})`}
        strokeWidth="18"
      />
      <circle
        cx="256"
        cy="256"
        r="126"
        fill="none"
        stroke={`url(#${goldId})`}
        strokeOpacity="0.25"
        strokeWidth="4"
        strokeDasharray="16 12"
      />

      {/* 四方席位好友圆章（东西南北围坐） */}
      <g stroke="#0f172a" strokeWidth="12">
        {/* 北席：本场大赢家（红＝赢，略大突出） */}
        <circle cx="256" cy="86" r="42" fill={`url(#${redId})`} />
        {/* 南席：绿＝输（呼应红赢绿输业务规则） */}
        <circle cx="256" cy="426" r="34" fill={`url(#${greenId})`} />
        {/* 西席与东席：两位同桌好友（高亮暖银白） */}
        <circle cx="86" cy="256" r="34" fill="#f1f5f9" />
        <circle cx="426" cy="256" r="34" fill="#f1f5f9" />
      </g>
      {/* 北席大赢家金圈加冕环 */}
      <circle cx="256" cy="86" r="42" fill="none" stroke={`url(#${goldId})`} strokeWidth="6" />

      {/* 圆桌中央：大赢家三尖黄金皇冠 */}
      <g transform="translate(0 8)">
        <path
          d="M178 284 L160 202 L216 240 L256 178 L296 240 L352 202 L334 284 Z"
          fill={`url(#${goldId})`}
        />
        <rect x="178" y="294" width="156" height="22" rx="11" fill={`url(#${goldId})`} />
        <circle cx="160" cy="190" r="11" fill="#fef08a" />
        <circle cx="256" cy="164" r="14" fill="#fef08a" />
        <circle cx="352" cy="190" r="11" fill="#fef08a" />
        <circle cx="256" cy="252" r="14" fill={`url(#${redId})`} />
      </g>
    </svg>
  );
}
