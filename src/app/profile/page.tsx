'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { PasswordInput } from '@/components/PasswordInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyFallbackModal } from '@/components/CopyFallbackModal';
import { AVATAR_THEMES } from '@/lib/format';
import { apiMutate } from '@/lib/apiClient';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useCopyText } from '@/lib/useCopyText';
import { useFocusTrap } from '@/lib/useFocusTrap';
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
  const { user, players, defaultRoomFee, logout, refreshUser, showToast } = useApp();
  const isAdmin = user?.role === 'ADMIN';

  // 个人资料修改
  const [nickname, setNickname] = useState('');
  const [avatarColor, setAvatarColor] = useState('red');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // 管理员设置：默认房费
  const [feeInput, setFeeInput] = useState(defaultRoomFee);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeErr, setFeeErr] = useState('');

  // 管理子页
  const [tab, setTab] = useState<'personal' | 'admin'>('personal');
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);
  const { copy, fallback, clearFallback } = useCopyText();

  // 新增玩家弹窗
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [newInitPassword, setNewInitPassword] = useState('123456');
  const [newRole, setNewRole] = useState<'PLAYER' | 'ADMIN'>('PLAYER');
  const [newColor, setNewColor] = useState('red');
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState('');

  // 编辑玩家弹窗
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editColor, setEditColor] = useState('red');
  const [editRole, setEditRole] = useState<'PLAYER' | 'ADMIN'>('PLAYER');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState('');

  // 通用确认弹层
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const editDialogRef = useRef<HTMLDivElement>(null);
  const addDialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(Boolean(editingUser));
  useFocusTrap(Boolean(editingUser), editDialogRef);
  useBodyScrollLock(showAddUser);
  useFocusTrap(showAddUser, addDialogRef);

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
    }
  }, [user]);

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
      const payload: Record<string, string> = {
        nickname: nickname.trim(),
        avatarColor,
      };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      await apiMutate('/api/auth/me', 'PATCH', payload);
      setProfileMsg('资料更新成功');
      setCurrentPassword('');
      setNewPassword('');
      await refreshUser();
      setTimeout(() => setProfileMsg(''), 3000);
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

  // 复制微信专属免登链接
  async function handleCopyBindUrl(u: ManagedUser) {
    if (!u.bindToken || typeof window === 'undefined') return;
    const url = `${window.location.origin}/bind?token=${u.bindToken}`;
    const ok = await copy(url);
    if (ok) {
      setCopiedTokenId(u.id);
      setTimeout(() => setCopiedTokenId(null), 2500);
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
      message: '密码将重置为 "123456"，其所有已绑定设备会被下线，需重新登录。',
      confirmText: '重置密码',
      danger: true,
      action: async () => {
        await apiMutate(`/api/users/${u.id}`, 'PATCH', { password: '123456' });
        showToast(`已将 ${u.nickname} 的密码重置为 123456`);
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
      await apiMutate(`/api/users/${editingUser.id}`, 'PATCH', {
        username: editUsername.trim(),
        nickname: editNickname.trim(),
        avatarColor: editColor,
        role: editRole,
        isActive: editIsActive,
      });
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
      setNewInitPassword('123456');
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
          <PlayerAvatar nickname={user?.nickname || '我'} color={user?.avatarColor} size="lg" />
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
              <span className="text-sm text-slate-500 mb-1.5 block">头像主题色</span>
              <div className="flex flex-wrap gap-2">
                {AVATAR_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAvatarColor(t.id)}
                    aria-label={t.label}
                    aria-pressed={avatarColor === t.id}
                    className={`w-11 h-11 rounded-full ${t.bg} flex items-center justify-center transition ${
                      avatarColor === t.id
                        ? 'ring-2 ring-slate-900 ring-offset-2 scale-105'
                        : 'opacity-70'
                    }`}
                  >
                    {avatarColor === t.id && <Check size={18} className="text-white drop-shadow" />}
                  </button>
                ))}
              </div>
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
                        <PlayerAvatar nickname={u.nickname} color={u.avatarColor} size="sm" />
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
                        className="flex shrink-0 items-center gap-1 min-h-10 px-2.5 rounded-lg bg-amber-400 text-slate-950 font-medium text-xs shadow-sm active:scale-95 transition"
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
                <span className="text-sm text-slate-500 mb-1.5 block">头像配色</span>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setEditColor(t.id)}
                      aria-label={t.label}
                      aria-pressed={editColor === t.id}
                      className={`w-11 h-11 rounded-full ${t.bg} flex items-center justify-center transition ${
                        editColor === t.id
                          ? 'ring-2 ring-slate-900 ring-offset-2 scale-105'
                          : 'opacity-60'
                      }`}
                    >
                      {editColor === t.id && <Check size={18} className="text-white drop-shadow" />}
                    </button>
                  ))}
                </div>
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
                  初始密码（默认 123456）
                </label>
                <PasswordInput
                  id="add-password"
                  value={newInitPassword}
                  onChange={setNewInitPassword}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <span className="text-sm text-slate-500 mb-1.5 block">头像配色</span>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNewColor(t.id)}
                      aria-label={t.label}
                      aria-pressed={newColor === t.id}
                      className={`w-11 h-11 rounded-full ${t.bg} flex items-center justify-center transition ${
                        newColor === t.id
                          ? 'ring-2 ring-slate-900 ring-offset-2 scale-105'
                          : 'opacity-60'
                      }`}
                    >
                      {newColor === t.id && <Check size={18} className="text-white drop-shadow" />}
                    </button>
                  ))}
                </div>
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
