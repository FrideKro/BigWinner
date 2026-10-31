'use client';

import React, { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { fileToAvatarDataUrl } from '@/lib/avatarImage';

interface AvatarImagePickerProps {
  /** 当前已保存的头像图片（data URL 或 null），用于预览兜底与「移除」按钮显隐 */
  current: string | null;
  /** 受控选择态：undefined = 未改动；null = 待移除；string = 待设置的新图 */
  value?: string | null;
  onChange: (next: string | null | undefined) => void;
  disabled?: boolean;
}

/**
 * 头像图片选择器：圆形预览按钮触发相册选图，前端压缩后回传 data URL；
 * 不做即时上传，随外层表单一起保存
 */
export function AvatarImagePicker({ current, value, onChange, disabled }: AvatarImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState('');

  // 预览优先级：待设置新图 > 待移除（落默认）> 当前已保存
  const previewSrc = value === undefined ? current : value;
  // 「移除图片」：未改动且有现有图可直接移除；已选新图时可改为移除；已在待移除状态则不重复展示
  const showRemove = value === undefined ? Boolean(current) : value !== null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 允许重复选择同一张图
    e.target.value = '';
    if (!file || disabled) return;
    setError('');
    setCompressing(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败');
    } finally {
      setCompressing(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || compressing}
        aria-label="选择头像图片"
        className="relative w-16 h-16 rounded-full bg-slate-100 ring-2 ring-slate-200 overflow-hidden flex items-center justify-center active:scale-95 transition disabled:opacity-60"
      >
        {previewSrc ? (
          // 预览对象为前端压缩后的 base64 data URL，next/image 无优化空间
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt="头像预览"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <Camera size={22} className="text-slate-400" />
        )}
        <span className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-slate-900/80 flex items-center justify-center">
          <Camera size={13} className="text-white" />
        </span>
        {compressing && (
          <span className="absolute inset-0 bg-slate-900/40 text-xs text-white flex items-center justify-center">
            处理中…
          </span>
        )}
      </button>

      <div className="min-w-0 space-y-1">
        <p className="text-sm text-slate-500">想用微信头像？先长按保存到手机相册，再点圆框选择</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || compressing}
            className="text-sm text-slate-700 underline underline-offset-2 disabled:opacity-50"
          >
            选图
          </button>
          {value !== undefined && (
            <button
              type="button"
              onClick={() => {
                setError('');
                onChange(undefined);
              }}
              className="text-sm text-slate-500 underline underline-offset-2"
            >
              还原
            </button>
          )}
          {(value === undefined || typeof value === 'string') && showRemove && (
            <button
              type="button"
              onClick={() => {
                setError('');
                onChange(null);
              }}
              className="text-sm text-rose-600 underline underline-offset-2"
            >
              移除图片
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600 flex items-center gap-1">
            <X size={14} />
            {error}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
