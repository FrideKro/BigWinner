'use client';

import { Check } from 'lucide-react';
import { AVATAR_THEMES } from '@/lib/format';

interface AvatarThemePickerProps {
  value: string;
  onChange: (colorId: string) => void;
  /** 未选中项的透明度类（个人资料页略亮、弹窗内略暗） */
  inactiveClassName?: string;
}

// 头像主题色选择格：个人资料、编辑玩家、新增玩家三处共用
export function AvatarThemePicker({
  value,
  onChange,
  inactiveClassName = 'opacity-60',
}: AvatarThemePickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {AVATAR_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-label={t.label}
          aria-pressed={value === t.id}
          className={`w-11 h-11 rounded-full ${t.bg} flex items-center justify-center transition ${
            value === t.id ? 'ring-2 ring-slate-900 ring-offset-2 scale-105' : inactiveClassName
          }`}
        >
          {value === t.id && <Check size={18} className="text-white drop-shadow" />}
        </button>
      ))}
    </div>
  );
}
