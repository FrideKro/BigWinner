'use client';

interface InlineErrorBannerProps {
  onRetry: () => void;
  /** 额外布局类（如列表页的 lg:col-span-2） */
  className?: string;
}

// 已有旧数据时刷新失败的降级提示：保留旧内容，仅顶部提示并可重试
export function InlineErrorBanner({ onRetry, className = '' }: InlineErrorBannerProps) {
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ${className}`}
    >
      <span className="truncate">刷新失败，显示上次数据</span>
      <button onClick={onRetry} className="shrink-0 min-h-9 px-2 font-medium underline">
        重试
      </button>
    </div>
  );
}
