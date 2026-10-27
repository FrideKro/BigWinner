'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { AVATAR_THEMES, copyTextToClipboard } from '@/lib/format';
import {
  User,
  Shield,
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
  bindToken?: string;
  deviceCount?: number;
  createdAt: string;
}

export default function ProfilePage() {
  const { user, logout, refreshUser } = useApp();

  // 个人资料修改
  const [nickname, setNickname] = useState('');
  const [avatarColor, setAvatarColor] = useState('red');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // 管理员设置：默认房费
  const [defaultRoomFee, setDefaultRoomFee] = useState(100);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeMsg, setFeeMsg] = useState('');

  // 管理员：玩家管理列表
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);

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

  // 初始化当前用户数据
  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
      setAvatarColor(user.avatarColor || 'red');
    }
  }, [user]);

  // 加载管理员设置与玩家列表
  const loadAdminData = useCallback(async () => {
    if (user?.role !== 'ADMIN') return;
    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/users'),
      ]);
      if (settingsRes.ok) {
        const sdata = await settingsRes.json();
        setDefaultRoomFee(sdata.defaultRoomFee || 100);
      }
      if (usersRes.ok) {
        const udata = await usersRes.json();
        setManagedUsers(udata.users || []);
      }
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

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

      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileErr(data.error || '保存失败');
        setProfileSaving(false);
        return;
      }

      setProfileMsg('资料更新成功');
      setCurrentPassword('');
      setNewPassword('');
      await refreshUser();
      setTimeout(() => setProfileMsg(''), 3000);
    } catch {
      setProfileErr('网络错误，保存失败');
    } finally {
      setProfileSaving(false);
    }
  }

  // 保存默认房费
  async function handleSaveFee() {
    setFeeMsg('');
    setFeeSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRoomFee }),
      });
      if (res.ok) {
        setFeeMsg('默认房费已更新');
        setTimeout(() => setFeeMsg(''), 2500);
        await refreshUser();
      }
    } finally {
      setFeeSaving(false);
    }
  }

  // 复制微信专属免登链接
  async function handleCopyBindUrl(u: ManagedUser) {
    if (!u.bindToken || typeof window === 'undefined') return;
    const url = `${window.location.origin}/bind?token=${u.bindToken}`;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopiedTokenId(u.id);
      setTimeout(() => setCopiedTokenId(null), 2500);
    }
  }

  // 重新生成专属绑定 Token
  async function handleRegenerateToken(u: ManagedUser) {
    if (!window.confirm(`重新生成【${u.nickname}】的专属链接？原链接及已绑定的设备将失效。`)) {
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerateBindToken: true, revokeDevices: true }),
    });
    if (res.ok) {
      loadAdminData();
    }
  }

  // 重置指定玩家密码为 123456
  async function handleResetPassword(u: ManagedUser) {
    if (!window.confirm(`确定将【${u.nickname}】的登录密码重置为 "123456" 吗？`)) {
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '123456' }),
    });
    if (res.ok) {
      alert(`已成功将 ${u.nickname} 的密码重置为 123456`);
    }
  }

  // 切换账号启用/停用
  async function handleToggleActive(u: ManagedUser) {
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    if (res.ok) {
      loadAdminData();
      await refreshUser();
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
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editUsername.trim(),
          nickname: editNickname.trim(),
          avatarColor: editColor,
          role: editRole,
          isActive: editIsActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditErr(data.error || '保存失败');
        return;
      }

      setEditingUser(null);
      await loadAdminData();
      await refreshUser();
    } catch {
      setEditErr('网络错误，保存失败');
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
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          nickname: newNickname.trim(),
          password: newInitPassword,
          role: newRole,
          avatarColor: newColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddErr(data.error || '创建失败');
        setAddSaving(false);
        return;
      }

      setShowAddUser(false);
      setNewUsername('');
      setNewNickname('');
      setNewInitPassword('123456');
      loadAdminData();
      await refreshUser();
    } catch {
      setAddErr('网络错误，创建失败');
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-4 pt-4 pb-16">
      {/* 头部身份卡片 */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PlayerAvatar nickname={user?.nickname || '我'} color={user?.avatarColor} size="lg" />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-medium text-slate-900">{user?.nickname}</h1>
              <span className="px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 text-xs font-medium">
                {user?.role === 'ADMIN' ? '管理员' : '玩家'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">账号：{user?.username}</p>
          </div>
        </div>

        <button
          onClick={logout}
          className="p-2.5 rounded-2xl bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition"
          title="退出登录"
        >
          <LogOut size={16} />
        </button>
      </div>

      {/* 双列区：窄屏纵向堆叠，lg 起资料修改与管理台并排 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* 个人资料修改 */}
        <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
            <User size={15} className="text-amber-500" />
            <span>修改个人设置</span>
          </h2>

          <form onSubmit={handleSaveProfile} className="space-y-3.5">
            <div>
              <label className="text-sm text-slate-500 mb-1 block">显示昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div>
              <label className="text-sm text-slate-500 mb-1.5 block">头像主题色</label>
              <div className="flex flex-wrap gap-2">
                {AVATAR_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAvatarColor(t.id)}
                    className={`w-7 h-7 rounded-full ${t.bg} flex items-center justify-center transition ${
                      avatarColor === t.id
                        ? 'ring-2 ring-slate-900 ring-offset-2 scale-110'
                        : 'opacity-70'
                    }`}
                  >
                    {avatarColor === t.id && <Check size={14} className="text-white drop-shadow" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-sm text-slate-400 block">修改登录密码（不改请留空）</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="当前密码"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="新密码（至少 4 位）"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {profileErr && (
              <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                {profileErr}
              </div>
            )}
            {profileMsg && (
              <div className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl">
                {profileMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium active:scale-[0.99] transition disabled:opacity-50"
            >
              {profileSaving ? '保存中…' : '保存设置'}
            </button>
          </form>
        </div>

        {/* 管理员专区 */}
        {user?.role === 'ADMIN' && (
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 px-1 pt-2">
              <Shield size={16} className="text-amber-500" />
              <h2 className="text-sm font-medium text-slate-800 tracking-wider">管理员控制台</h2>
            </div>

            {/* 默认房费配置 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                <Settings size={15} className="text-amber-500" />
                <span>默认每场房费设置</span>
              </h3>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    +
                  </span>
                  <input
                    type="number"
                    value={defaultRoomFee}
                    onChange={(e) => setDefaultRoomFee(parseInt(e.target.value || '0', 10))}
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold"
                  />
                </div>
                <button
                  onClick={handleSaveFee}
                  disabled={feeSaving}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium shrink-0"
                >
                  {feeSaving ? '保存中' : '更新'}
                </button>
              </div>
              {feeMsg && <span className="text-sm text-emerald-600 block">{feeMsg}</span>}
            </div>

            {/* 玩家账号管理 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Users size={15} className="text-amber-500" />
                  <span>玩家账号与微信免密链接 ({managedUsers.length})</span>
                </h3>
                <button
                  onClick={() => setShowAddUser(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-900 text-white text-sm font-medium shadow-sm"
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
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <PlayerAvatar nickname={u.nickname} color={u.avatarColor} size="sm" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-slate-800">
                                {u.nickname}
                              </span>
                              <span className="text-xs text-slate-400 font-mono">
                                ({u.username})
                              </span>
                              {u.role === 'ADMIN' && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 text-xs font-medium">
                                  官
                                </span>
                              )}
                              {!u.isActive && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-500 text-xs">
                                  已隐藏
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              已绑微信/设备：{u.deviceCount ?? 0} 台
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          {/* 复制微信专属免登链接 */}
                          <button
                            onClick={() => handleCopyBindUrl(u)}
                            title="复制微信专属免登激活链接"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-medium text-xs shadow-sm active:scale-95 transition"
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
                      </div>

                      {/* 操作小工具行 */}
                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-200/60 text-xs text-slate-500">
                        <button
                          onClick={() => handleStartEdit(u)}
                          className="hover:text-slate-800 flex items-center gap-0.5"
                        >
                          <Pencil size={11} />
                          编辑
                        </button>
                        <span>·</span>
                        <button
                          onClick={() => handleResetPassword(u)}
                          className="hover:text-slate-800 flex items-center gap-0.5"
                        >
                          <KeyRound size={11} />
                          重置密码
                        </button>
                        <span>·</span>
                        <button
                          onClick={() => handleRegenerateToken(u)}
                          className="hover:text-slate-800 flex items-center gap-0.5"
                        >
                          <RefreshCw size={11} />
                          换新链接
                        </button>
                        <span>·</span>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={
                            u.isActive ? 'hover:text-rose-600' : 'text-emerald-600 font-medium'
                          }
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
      </div>

      {/* 编辑玩家弹窗 */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseEdit}
          />
          <div className="relative w-full max-w-sm md:max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <PlayerAvatar
                nickname={editNickname || editingUser.nickname}
                color={editColor}
                size="sm"
              />
              <h3 className="text-base font-medium text-slate-900">
                编辑玩家 · {editingUser.nickname}
              </h3>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="text-sm text-slate-500 mb-1 block">登录用户名</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1 block">显示昵称</label>
                <input
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1.5 block">头像配色</label>
                <div className="flex gap-2">
                  {AVATAR_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setEditColor(t.id)}
                      className={`w-7 h-7 rounded-full ${t.bg} flex items-center justify-center transition ${
                        editColor === t.id
                          ? 'ring-2 ring-slate-900 ring-offset-2 scale-110'
                          : 'opacity-60'
                      }`}
                    >
                      {editColor === t.id && <Check size={14} className="text-white drop-shadow" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1 block">角色权限</label>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditRole('PLAYER')}
                    className={`flex-1 py-1.5 rounded-xl border ${
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
                    className={`flex-1 py-1.5 rounded-xl border ${
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
                <label className="text-sm text-slate-500 mb-1 block">账号状态</label>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditIsActive(true)}
                    className={`flex-1 py-1.5 rounded-xl border ${
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
                    className={`flex-1 py-1.5 rounded-xl border ${
                      !editIsActive
                        ? 'bg-slate-900 text-white font-medium'
                        : 'bg-white text-slate-600'
                    }`}
                  >
                    从选人隐藏
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  隐藏后不出现在记账与看板的选人列表，历史战绩保留
                </p>
              </div>

              {editErr && (
                <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                  {editErr}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-red-600 text-white text-sm font-medium disabled:opacity-50"
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
            onClick={() => setShowAddUser(false)}
          />
          <div className="relative w-full max-w-sm md:max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <h3 className="text-base font-medium text-slate-900">新增玩家账号</h3>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="text-sm text-slate-500 mb-1 block">登录用户名</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="如：laozhang"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1 block">显示昵称</label>
                <input
                  type="text"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  placeholder="如：老张"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1 block">初始密码（默认 123456）</label>
                <input
                  type="text"
                  value={newInitPassword}
                  onChange={(e) => setNewInitPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-base bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1.5 block">头像配色</label>
                <div className="flex gap-2">
                  {AVATAR_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNewColor(t.id)}
                      className={`w-6 h-6 rounded-full ${t.bg} ${
                        newColor === t.id ? 'ring-2 ring-slate-900 scale-110' : 'opacity-60'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-500 mb-1 block">角色权限</label>
                <div className="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setNewRole('PLAYER')}
                    className={`flex-1 py-1.5 rounded-xl border ${
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
                    className={`flex-1 py-1.5 rounded-xl border ${
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
                <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">
                  {addErr}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUser(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-red-600 text-white text-sm font-medium"
                >
                  {addSaving ? '创建中…' : '确认新增'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
