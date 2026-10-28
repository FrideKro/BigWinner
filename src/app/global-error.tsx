'use client';

import React, { useEffect } from 'react';

// 全局兜底：根布局本身出错时使用，内联样式确保不依赖 Tailwind
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f1f5f9',
          color: '#0f172a',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>页面加载失败</h1>
          <p style={{ fontSize: 14, color: '#475569', marginTop: 8 }}>
            请重新加载页面，若持续失败请联系管理员
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: '0 20px',
              borderRadius: 12,
              border: 'none',
              background: '#0f172a',
              color: '#fff',
              fontSize: 14,
            }}
          >
            重新加载
          </button>
        </div>
      </body>
    </html>
  );
}
