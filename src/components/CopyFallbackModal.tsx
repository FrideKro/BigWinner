'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useFocusTrap } from '@/lib/useFocusTrap';

interface CopyFallbackModalProps {
  text: string | null;
  onClose: () => void;
}

// 微信/HTTP 环境下自动复制可能失败，兜底展示可长按选择的文本
export function CopyFallbackModal({ text, onClose }: CopyFallbackModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const open = text !== null;

  useBodyScrollLock(open);
  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (text === null) return;
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, [text]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (text === null) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-fallback-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl outline-none space-y-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2 id="copy-fallback-title" className="text-base font-medium text-slate-900">
            复制战报
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-slate-600">自动复制失败，请长按下方文本选择复制：</p>
        <textarea
          ref={textareaRef}
          readOnly
          value={text}
          rows={9}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        />
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-full rounded-xl bg-slate-900 text-sm font-medium text-white"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
