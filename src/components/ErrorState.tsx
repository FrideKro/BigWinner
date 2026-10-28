'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}

export function ErrorState({ message, onRetry, compact = false }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`rounded-3xl bg-white border border-rose-100 flex flex-col items-center justify-center text-center ${
        compact ? 'py-6 px-4 gap-2' : 'py-10 px-6 gap-3'
      }`}
    >
      <AlertCircle size={compact ? 24 : 32} className="text-rose-400" />
      <p className="text-sm text-slate-600">{message}</p>
      <button
        onClick={onRetry}
        className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white active:scale-[0.98] transition"
      >
        <RefreshCw size={14} />
        重新加载
      </button>
    </div>
  );
}
