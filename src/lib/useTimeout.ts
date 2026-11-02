'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * 组件卸载时自动清理的 setTimeout。
 * 同一实例重复调用会覆盖上一个未触发的定时器（适合「点亮后延时熄灭」类状态）；
 * 需要多个互不干扰的定时器时，在组件内调用多个实例。
 */
export function useTimeout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback((fn: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, ms);
  }, []);
}
