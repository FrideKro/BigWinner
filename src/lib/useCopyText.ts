'use client';

import { useCallback, useState } from 'react';
import { copyTextToClipboard } from './format';

/**
 * 复制文本；失败时保留原文，供页面弹出可长按选择的兜底弹层。
 */
export function useCopyText() {
  const [fallback, setFallback] = useState<string | null>(null);

  const copy = useCallback(async (text: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) setFallback(text);
    return ok;
  }, []);

  const clearFallback = useCallback(() => setFallback(null), []);

  return { copy, fallback, clearFallback };
}
