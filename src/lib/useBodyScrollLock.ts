'use client';

import { useEffect } from 'react';

// 多个弹层可能同时打开（如弹窗上的确认框），用计数避免内层关闭时提前解锁页面
let lockCount = 0;
let originalOverflow = '';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow;
      }
    };
  }, [active]);
}
