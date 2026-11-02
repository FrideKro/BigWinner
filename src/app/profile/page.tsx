'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { AvatarImagePicker } from '@/components/AvatarImagePicker';
import { AvatarThemePicker } from '@/components/AvatarThemePicker';
import { PasswordInput } from '@/components/PasswordInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyFallbackModal } from '@/components/CopyFallbackModal';
import { validatePassword } from '@/lib/profileValidation';
import { apiMutate } from '@/lib/apiClient';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useCopyText } from '@/lib/useCopyText';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useTimeout } from '@/lib/useTimeout';
import {
  User,
  KeyRound,
  Link,
  Plus,
  RefreshCw,
  LogOut,
  Check,
  Settings,
  Users,
  Pencil,
} from 'lucide-react';

interface ManagedUser {
  id: number;
  username: string;
  nickname: string;
  role: 'ADMIN' | 'PLAYER';
  avatarColor: string;
  isActive: boolean;
  bindToken?: string | null;
  deviceCount?: number;
  createdAt?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  action: () => Promise<void>;
}

export default function ProfilePage() {
  const {
    user,
    players,
    defaultRoomFee,
    passwordLoginEnabled,
    logout,
    refreshUser,
    showToast,
    getAvatarImage,
  } = useApp();
  const isAdmin = user?.role === 'ADMIN';

  // 个人资料修改
  const [nickname, setNickname] = useState('');
  const [avatarColor, setAvatarColor] = useState('red');
  // 头像图片选择态：undefined = 未改动；null = 待移除；string = 待设置的新图
  const [avatarImage, setAvatarImage] = useState<string | null | undefined>(undefined);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // 管理员设置：默认房费
  const [feeInput, setFeeInput] = useState(defaultRoomFee);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeErr, setFeeErr] = useState('');

  // 管理员设置：玩家密码登录开关
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordErr, setPasswordErr] = useState('');

  // 管理子页
  const [tab, setTab] = useState<'personal' | 'admin'>('personal');
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);
  const { copy, fallback, clearFallback } = useCopyText();
  // 两处独立的「延时复位」状态各用一个实例，避免相互覆盖（卸载自动清理）
  const scheduleProfileMsgClear = useTimeout();
  const scheduleCopiedTokenClear = useTimeout();

  // 新增玩家弹窗
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [newInitPassword, setNewInitPassword] = useState('');
  const [newRole, setNewRole] = useState<'PLAYER' | 'ADMIN'>('PLAYER');
  const [newColor, setNewColor] = useState('red');
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState('');

  // 编辑玩家弹窗
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editColor, setEditColor] = useState('red');
  const [editAvatarImage, setEditAvatarImage] = useState<string | null | undefined>(undefined);
  const [editRole, setEditRole] = useState<'PLAYER' | 'ADMIN'>('PLAYER');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');

  // 通用确认弹层
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // 重置密码结果：随机密码仅在重置响应中出现一次，弹层展示给管理员复制
  const [resetResult, setResetResult] = useState<{ nickname: string; password: string } | null>(
    null,
  );

  const editDialogRef = useRef<HTMLDivElement>(null);
  const addDialogRef = useRef<HTMLDivElement>(null);
  const resetDialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(Boolean(editingUser));
  useFocusTrap(Boolean(editingUser), editDialogRef);
  useBodyScrollLock(showAddUser);
  useFocusTrap(showAddUser, addDialogRef);
  useBodyScrollLock(Boolean(resetResult));
  useFocusTrap(Boolean(resetResult), resetDialogRef);

  // 玩家列表直接复用 AppShell 的 bootstrap 数据，不再单独请求
  const managedUsers = useMemo<ManagedUser[]>(() => {
    if (!isAdmin) return [];
    return players
      .filter((p) => p.username && p.role)
      .map((p) => ({
        id: p.id,
        username: p.username as string,
        nickname: p.nickname,
        role: p.role as 'ADMIN' | 'PLAYER',
        avatarColor: p.avatarColor,
        isActive: p.isActive,
        bindToken: p.bindToken ?? null,
        deviceCount: p.deviceCount ?? 0,
        createdAt: p.createdAt ?? '',
      }));
  }, [players, isAdmin]);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
      setAvatarColor(user.avatarColor || 'red');
      setAvatarImage(undefined);
    }
  }, [user]);

  // 我当前已保存的头像图片（随头像本地缓存同步，玩家列表不再内联下发 data URL）
  const myAvatarImage = user ? getAvatarImage(user.id) : null;

  useEffect(() => {
    setFeeInput(defaultRoomFee);
  }, [defaultRoomFee]);

  // 编辑/新增弹窗 Esc 关闭
  useEffect(() => {
    if (!editingUser) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editSaving) {
        setEditingUser(null);
        setEditErr('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingUser, editSaving]);

  useEffect(() => {
    if (!showAddUser) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !addSaving) setShowAddUser(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showAddUser, addSaving]);

  // 保存个人资料
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg('');
    setProfileErr('');
    setProfileSaving(true);

    try {
      const payload: Record<string, string | null> = {
        nickname: nickname.trim(),
        avatarColor,
      };
      // 头像图片仅在有改动时提交（undefined = 不动，null = 清除）
      if (avatarImage !== undefined) {
        payload.avatarImage = avatarImage;
      }
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      await apiMutate('/api/auth/me', 'PATCH', payload);
      setProfileMsg('资料更新成功');
      setCurrentPassword('');
      setNewPassword('');
      await refreshUser();
      scheduleProfileMsgClear(() => setProfileMsg(''), 3000);
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : '保存失败');
    } finally {
      setProfileSaving(false);
    }
  }

  // 保存默认房费
  async function handleSaveFee() {
    setFeeErr('');
    if (!Number.isInteger(feeInput) || feeInput < 0) {
      setFeeErr('默认房费必须为非负整数');
      return;
    }
    setFeeSaving(true);
    try {
      await apiMutate('/api/settings', 'PUT', { defaultRoomFee: feeInput });
      showToast('默认房费已更新');
      await refreshUser();
    } catch (err) {
      setFeeErr(err instanceof Error ? err.message : '保存失败');
    } finally {
      setFeeSaving(false);
    }
  }

  // 切换玩家密码登录开关
  async function handleTogglePasswordLogin() {
    if (passwordSaving) return;
    setPasswordErr('');
    const next = !passwordLoginEnabled;
    setPasswordSaving(true);
    try {
      await apiMutate('/api/settings', 'PUT', { passwordLoginEnabled: next });
      showToast(next ? '已开启玩家密码登录' : '已关闭玩家密码登录');
      await refreshUser();
    } catch (err) {
      setPasswordErr(err instanceof Error ? err.message : '保存失败');
    } finally {
      setPasswordSaving(false);
    }
  }

  // 复制微信专属免登链接
  async function handleCopyBindUrl(u: ManagedUser) {
    if (!u.bindToken || typeof window === 'undefined') return;
    const url = `${window.location.origin}/bind?token=${u.bindToken}`;
    const ok = await copy(url);
    if (ok) {
      setCopiedTokenId(u.id);
      scheduleCopiedTokenClear(() => setCopiedTokenId(null), 2500);
    } else {
      showToast('复制失败，请长按选择文本');
    }
  }

  function handleRegenerateToken(u: ManagedUser) {
    setConfirmState({
      title: `重新生成【${u.nickname}】的专属链接？`,
      message: '原链接及已绑定的设备将失效，需要重新发送链接给该玩家。',
      confirmText: '重新生成',
      danger: true,
      action: async () => {
        await apiMutate(`/api/users/${u.id}`, 'PATCH', {
          regenerateBindToken: true,
          revokeDevices: true,
        });
        showToast('已生成新链接，旧链接已失效');
        await refreshUser();
      },
    });
  }

  function handleResetPassword(u: ManagedUser) {
    setConfirmState({
      title: `重置【${u.nickname}】的密码？`,
      message: '将为其生成新的随机密码，并下线所有已绑定设备，需重新登录。',
      confirmText: '重置密码',
      danger: true,
      action: async () => {
        const res = await apiMutate<{ newPassword?: string }>(`/api/users/${u.id}`, 'PATCH', {
          resetPassword: true,
        });
        // 随机密码只在此响应中出现一次，立即弹出复制弹层
        if (res.newPassword) {
          setResetResult({ nickname: u.nickname, password: res.newPassword });
        }
        await refreshUser();
      },
    });
  }

  async function handleToggleActive(u: ManagedUser) {
    try {
      await apiMutate(`/api/users/${u.id}`, 'PATCH', { isActive: !u.isActive });
      showToast(u.isActive ? '已从选人列表隐藏' : '已恢复到选人列表');
      await refreshUser();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function runConfirm() {
    if (!confirmState) return;
    const action = confirmState.action;
    setConfirmBusy(true);
    try {
      await action();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败');
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  }

  // 打开编辑玩家弹窗
  function handleStartEdit(u: ManagedUser) {
    setEditingUser(u);
    setEditUsername(u.username);
    setEditNickname(u.nickname);
    setEditColor(u.avatarColor || 'red');
    setEditAvatarImage(undefined);
    setEditRole(u.role);
    setEditIsActive(u.isActive);
    setEditErr('');
  }

  function handleCloseEdit() {
    if (editSaving) return;
    setEditingUser(null);
    setEditErr('');
  }

  // 保存玩家资料
  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setEditErr('');

    if (!editUsername.trim() || !editNickname.trim()) {
      setEditErr('登录用户名和显示昵称不能为空');
      return;
    }

    setEditSaving(true);
    try {
      const payload: Record<string, string | boolean | null> = {
        username: editUsername.trim(),
        nickname: editNickname.trim(),
        avatarColor: editColor,
        role: editRole,
        isActive: editIsActive,
      };
      if (editAvatarImage !== undefined) {
        payload.avatarImage = editAvatarImage;
      }
      await apiMutate(`/api/users/${editingUser.id}`, 'PATCH', payload);
      setEditingUser(null);
      showToast('玩家资料已更新');
      await refreshUser();
    } catch (err) {
      setEditErr(err instanceof Error ? err.message : '保存失败');
    } finally {
      setEditSaving(false);
    }
  }

  // 创建新玩家
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setAddErr('');
    if (!newUsername.trim() || !newNickname.trim()) {
      setAddErr('请填写用户名和昵称');
      return;
    }
    // 与服务端同口径：初始密码必填（4~72 位），不再有弱默认值
    const passwordError = validatePassword(newInitPassword, '初始密码');
    if (passwordError) {
      setAddErr(passwordError);
      return;
    }
    setAddSaving(true);
    try {
      await apiMutate('/api/users', 'POST', {
        username: newUsername.trim(),
        nickname: newNickname.trim(),
        password: newInitPassword,
        role: newRole,
        avatarColor: newColor,
      });
      setShowAddUser(false);
      setNewUsername('');
      setNewNickname('');
      setNewInitPassword('');
      showToast('玩家账号已创建');
      await refreshUser();
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : '创建失败');
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-4 pt-4 pb-16">
      {/* 头部身份卡片 */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <PlayerAvatar
            nickname={user?.nickname || '我'}
            color={user?.avatarColor}
            size="lg"
            src={user ? getAvatarImage(user.id) : null}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-base font-medium text-slate-900 truncate">{user?.nickname}</h1>
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 text-xs font-medium">
                {isAdmin ? '管理员' : '玩家'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">账号：{user?.username}</p>
          </div>
        </div>

        <button
          onClick={logout}
          aria-label="退出登录"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* 管理员：个人设置 / 管理台 子页切换，避免单页过长 */}
      {isAdmin && (
        <div className="flex items-center gap-1 p-1 bg-slate-200 rounded-2xl">
          <button
            onClick={() => setTab('personal')}
            className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-xl transition ${
              tab === 'personal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            个人设置
          </button>
          <button
            onClick={() => setTab('admin')}
            className={`flex-1 min-h-10 py-2 text-sm font-medium rounded-xl transition ${
              tab === 'admin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            管理员控制台
          </button>
        </div>
      )}

      {(tab === 'personal' || !isAdmin) && (
        <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
            <User size={15} className="text-amber-500" />
            <span>修改个人设置</span>
          </h2>

          <form onSubmit={handleSaveProfile} className="space-y-3.5">
            <div>
              <label htmlFor="profile-nickname" className="text-sm text-slate-500 mb-1 block">
                显示昵称
              </label>
              <input
                id="profile-nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoComplete="nickname"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div>
              <span className="text-sm text-slate-500 mb-1.5 block">头像图片</span>
              <AvatarImagePicker
                current={myAvatarImage}
                value={avatarImage}
                onChange={setAvatarImage}
                disabled={profileSaving}
              />
            </div>

            <div>
              <span className="text-sm text-slate-500 mb-1.5 block">头像主题色</span>
              <AvatarThemePicker
                value={avatarColor}
                onChange={setAvatarColor}
                inactiveClassName="opacity-70"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-sm text-slate-500 block">修改登录密码（不改请留空）</span>
              <label htmlFor="profile-current-password" className="sr-only">
                当前密码
              </label>
              <PasswordInput
                id="profile-current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="当前密码"
                autoComplete="current-password"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <label htmlFor="profile-new-password" className="sr-only">
                新密码
              </label>
              <PasswordInput
                id="profile-new-password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="新密码（至少 4 位）"
                autoComplete="new-password"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {profileErr && (
              <div role="alert" className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                {profileErr}
              </div>
            )}
            {profileMsg && (
              <div
                role="status"
                className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl"
              >
                {profileMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="w-full min-h-11 rounded-xl bg-slate-900 text-white text-sm font-medium active:scale-[0.99] transition disabled:opacity-50"
            >
              {profileSaving ? '保存中…' : '保存设置'}
            </button>
          </form>
        </div>
      )}

      {isAdmin && tab === 'admin' && (
        <div className="space-y-4">
          {/* 玩家密码登录开关 */}
          <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <KeyRound size={15} className="text-amber-500" />
                  <span>玩家密码登录</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  关闭后普通玩家只能通过微信免登链接访问，管理员始终可用密码登录
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={passwordLoginEnabled}
                aria-label="玩家密码登录开关"
                disabled={passwordSaving}
                onClick={handleTogglePasswordLogin}
                className={`relative shrink-0 w-14 h-8 rounded-full transition-colors disabled:opacity-50 ${
                  passwordLoginEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                    passwordLoginEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  passwordLoginEnabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {passwordLoginEnabled ? '已开启' : '已关闭'}
              </span>
              <span className="text-xs text-slate-500">
                {passwordLoginEnabled ? '玩家可用账号密码登录' : '玩家需使用免登链接'}
              </span>
            </div>
            {passwordErr && (
              <span role="alert" className="text-sm text-rose-600 block">
                {passwordErr}
              </span>
            )}
          </div>

          {/* 默认房费配置 */}
          <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Settings size={15} className="text-amber-500" />
              <span>默认每场房费设置</span>
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  +
                </span>
                <input
                  type="number"
                  min={0}
                  max={2147483647}
                  step={1}
                  inputMode="numeric"
                  value={feeInput}
                  onChange={(e) => setFeeInput(parseInt(e.target.value || '0', 10))}
                  aria-label="默认每场房费"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold tabular-nums"
                />
              </div>
              <button
                onClick={handleSaveFee}
                disabled={feeSaving}
                className="shrink-0 min-h-11 px-4 rounded-xl bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
              >
                {feeSaving ? '保存中' : '更新'}
              </button>
            </div>
            {feeErr && (
              <span role="alert" className="text-sm text-rose-600 block">
                {feeErr}
              </span>
            )}
          </div>

          {/* 玩家账号管理 */}
          <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5 min-w-0">
                <Users size={15} className="text-amber-500 shrink-0" />
                <span className="truncate">玩家账号与微信免密链接 ({managedUsers.length})</span>
              </h3>
              <button
                onClick={() => setShowAddUser(true)}
                className="flex shrink-0 items-center gap-1 min-h-10 px-3 rounded-full bg-slate-900 text-white text-sm font-medium shadow-sm"
              >
                <Plus size={14} />
                <span>新增玩家</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {managedUsers.map((u) => {
                const isCopied = copiedTokenId === u.id;
                return (
                  <div
                    key={u.id}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PlayerAvatar
                          nickname={u.nickname}
                          color={u.avatarColor}
                          size="sm"
                          src={getAvatarImage(u.id)}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-medium text-slate-800 truncate">
                              {u.nickname}
                            </span>
                            {u.role === 'ADMIN' && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 text-xs font-medium">
                                官
                              </span>
                            )}
                            {!u.isActive && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-xs">
                                已隐藏
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            ({u.username}) · 已绑设备 {u.deviceCount ?? 0} 台
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleCopyBindUrl(u)}
                        title="复制微信专属免登激活链接"
                        aria-label={`复制 ${u.nickname} 的微信免登链接`}
                        className="flex shrink-0 items-center gap-1 min-h-10 px-2.5 rounded-lg bg-[#07C160] text-white font-medium text-xs shadow-sm active:scale-95 transition"
                      >
                        {isCopied ? (
                          <>
                            <Check size={12} />
                            <span>已复制</span>
                          </>
                        ) : (
                          <>
                            <Link size={12} />
                            <span>微信免登链</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* 操作区：44px 高，窄屏两列 */}
                    <div className="grid grid-cols-2 xs:grid-cols-4 gap-1.5 pt-2 border-t border-slate-200/60">
                      <button
                        onClick={() => handleStartEdit(u)}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 active:scale-[0.98] transition"
                      >
                        <Pencil size={13} />
                        编辑
                      </button>
                      <button
                        onClick={() => handleResetPassword(u)}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 active:scale-[0.98] transition"
                      >
                        <KeyRound size={13} />
                        重置密码
                      </button>
                      <button
                        onClick={() => handleRegenerateToken(u)}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 active:scale-[0.98] transition"
                      >
                        <RefreshCw size={13} />
                        换新链接
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border text-xs font-medium active:scale-[0.98] transition ${
                          u.isActive
                            ? 'bg-white border-slate-200 text-slate-600'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        }`}
                      >
                        {u.isActive ? '从选人隐藏' : '恢复选人'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 编辑玩家弹窗 */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseEdit}
          />
          <div
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
            tabIndex={-1}
            className="relative w-full max-w-sm md:max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto outline-none pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center gap-2">
              <PlayerAvatar
                nickname={editNickname || editingUser.nickname}
                color={editColor}
                size="sm"
                src={
                  editAvatarImage === undefined ? getAvatarImage(editingUser.id) : editAvatarImage
                }
              />
              <h3 id="edit-user-title" className="text-base font-medium text-slate-900">
                编辑玩家 · {editingUser.nickname}
              </h3>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label htmlFor="edit-username" className="text-sm text-slate-500 mb-1 block">
                  登录用户名
                </label>
                <input
                  id="edit-username"
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label htmlFor="edit-nickname" className="text-sm text-slate-500 mb-1 block">
                  显示昵称
                </label>
                <input
                  id="edit-nickname"
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  autoComplete="nickname"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1.5 block">头像图片</span>
                <AvatarImagePicker
                  current={getAvatarImage(editingUser.id)}
                  value={editAvatarImage}
                  onChange={setEditAvatarImage}
                  disabled={editSaving}
                />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1.5 block">头像配色</span>
                <AvatarThemePicker value={editColor} onChange={setEditColor} />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1 block">角色权限</span>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditRole('PLAYER')}
                    aria-pressed={editRole === 'PLAYER'}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      editRole === 'PLAYER'
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    普通玩家
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditRole('ADMIN')}
                    aria-pressed={editRole === 'ADMIN'}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      editRole === 'ADMIN'
                        ? 'bg-amber-500 text-slate-950 font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    管理员
                  </button>
                </div>
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1 block">账号状态</span>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditIsActive(true)}
                    aria-pressed={editIsActive}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      editIsActive
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    正常显示
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditIsActive(false)}
                    aria-pressed={!editIsActive}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      !editIsActive
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    从选人隐藏
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  隐藏后不出现在记账与看板的选人列表，历史战绩保留
                </p>
              </div>

              {editErr && (
                <div role="alert" className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                  {editErr}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  disabled={editSaving}
                  className="flex-1 min-h-11 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 min-h-11 rounded-xl bg-gradient-to-r from-amber-500 to-red-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {editSaving ? '保存中…' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增玩家弹窗 */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !addSaving && setShowAddUser(false)}
          />
          <div
            ref={addDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
            tabIndex={-1}
            className="relative w-full max-w-sm md:max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto outline-none pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <h3 id="add-user-title" className="text-base font-medium text-slate-900">
              新增玩家账号
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label htmlFor="add-username" className="text-sm text-slate-500 mb-1 block">
                  登录用户名
                </label>
                <input
                  id="add-username"
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="如：laozhang"
                  autoComplete="off"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label htmlFor="add-nickname" className="text-sm text-slate-500 mb-1 block">
                  显示昵称
                </label>
                <input
                  id="add-nickname"
                  type="text"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder="如：老张"
                  autoComplete="nickname"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label htmlFor="add-password" className="text-sm text-slate-500 mb-1 block">
                  初始密码（4 ~ 72 位）
                </label>
                <PasswordInput
                  id="add-password"
                  value={newInitPassword}
                  onChange={setNewInitPassword}
                  autoComplete="new-password"
                  placeholder="必填，用于密码登录或管理员重置"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1.5 block">头像配色</span>
                <AvatarThemePicker value={newColor} onChange={setNewColor} />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1 block">角色权限</span>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setNewRole('PLAYER')}
                    aria-pressed={newRole === 'PLAYER'}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      newRole === 'PLAYER'
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    普通玩家
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole('ADMIN')}
                    aria-pressed={newRole === 'ADMIN'}
                    className={`flex-1 min-h-10 py-1.5 rounded-xl border ${
                      newRole === 'ADMIN'
                        ? 'bg-amber-500 text-slate-950 font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    管理员
                  </button>
                </div>
              </div>

              {addErr && (
                <div role="alert" className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                  {addErr}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUser(false)}
                  className="flex-1 min-h-11 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="flex-1 min-h-11 rounded-xl bg-gradient-to-r from-amber-500 to-red-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {addSaving ? '创建中…' : '确认新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 重置密码结果弹层：随机密码仅展示一次，关闭后不可再查看 */}
      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            ref={resetDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            tabIndex={-1}
            className="relative w-full max-w-sm md:max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4 outline-none pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <h3 id="reset-password-title" className="text-base font-medium text-slate-900">
              已重置【{resetResult.nickname}】的密码
            </h3>
            <p className="text-sm text-slate-600">
              请立即复制并转告玩家。关闭后无法再次查看，只能重新重置。
            </p>
            <div className="px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-center">
              <span className="text-lg font-medium tracking-widest tabular-nums break-all select-all">
                {resetResult.password}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (await copy(resetResult.password)) showToast('密码已复制');
                }}
                className="flex-1 min-h-11 rounded-xl bg-slate-900 text-white text-sm font-medium"
              >
                复制密码
              </button>
              <button
                type="button"
                onClick={() => setResetResult(null)}
                className="flex-1 min-h-11 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium"
              >
                我已复制，关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmText={confirmState?.confirmText}
        danger={confirmState?.danger}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={() => !confirmBusy && setConfirmState(null)}
      />

      <CopyFallbackModal text={fallback} onClose={clearFallback} />
    </div>
  );
}
