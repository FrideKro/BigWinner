'use client';

import React, { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  const isChunkError =
    error.name === 'ChunkLoadError' || /Loading chunk|Cannot find module/i.test(error.message);

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertCircle size={40} className="text-rose-400" />
      <div>
        <h1 className="text-base font-medium text-slate-900">页面加载失败</h1>
        <p className="mt-1 text-sm text-slate-600">
          {isChunkError ? '页面资源已更新，请重新加载' : '请稍后重试，若持续失败请联系管理员'}
        </p>
      </div>
      <button
        onClick={() => {
          if (isChunkError) {
            window.location.reload();
          } else {
            reset();
          }
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white"
      >
        <RefreshCw size={14} />
        重新加载
      </button>
    </div>
  );
}
