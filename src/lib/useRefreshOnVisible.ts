'use client';

import { useEffect, useRef } from 'react';

/**
 * 页面重新可见 / 窗口重新聚焦时刷新数据，解决“另一台设备记账后本机一直显示旧数据”。
 * 默认 5 秒内不重复触发，避免 focus 与 visibilitychange 同时触发。
 */
export function useRefreshOnVisible(refresh: () => void, minIntervalMs = 5000): void {
  const callbackRef = useRef(refresh);
  callbackRef.current = refresh;

  useEffect(() => {
    let lastRun = 0;

    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRun < minIntervalMs) return;
      lastRun = now;
      callbackRef.current();
    };

    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, [minIntervalMs]);
}
