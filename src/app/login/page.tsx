'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { LogoMark } from '@/components/LogoMark';
import { PasswordInput } from '@/components/PasswordInput';
import { invalidateApiCache } from '@/lib/apiClient';
import { Lock, User, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  // 会话失效由全局 401 处理写入 sessionStorage，登录页给出一次提示
  useEffect(() => {
    try {
      if (sessionStorage.getItem('bw_session_expired')) {
        setExpired(true);
        sessionStorage.removeItem('bw_session_expired');
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登录失败');
        setLoading(false);
        return;
      }
      if (data.deviceToken) {
        try {
          localStorage.setItem('bw_device_token', data.deviceToken);
        } catch {
          /* ignore */
        }
      }
      invalidateApiCache();
      const loggedIn = await refreshUser();
      if (!loggedIn) {
        setError('登录成功，但加载用户信息失败，请重试');
        setLoading(false);
        return;
      }
      router.replace('/');
    } catch {
      setError('网络连接错误，请稍后重试');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col justify-between px-6 py-12 short:py-5">
      {/* 顶部品牌 */}
      <div className="text-center pt-8 short:pt-1 space-y-3 short:space-y-1.5">
        <LogoMark size={80} className="w-20 h-20 short:w-14 short:h-14 drop-shadow-2xl" />
        <div>
          <h1 className="text-2xl font-medium tracking-wider bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent">
            大赢家
          </h1>
          <p className="text-sm text-slate-400 mt-1">好友娱乐战绩 · 输赢账本 · 房费统计</p>
        </div>
      </div>

      {/* 登录卡片 */}
      <div className="w-full max-w-sm mx-auto bg-slate-900/80 border border-slate-800 rounded-3xl p-6 short:p-4 shadow-xl backdrop-blur">
        {expired && (
          <div
            role="status"
            className="mb-4 text-sm text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-xl px-3.5 py-2.5"
          >
            登录已失效，请重新登录
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 short:space-y-2.5">
          <div>
            <label
              htmlFor="login-username"
              className="text-sm font-medium text-slate-400 block mb-1.5"
            >
              登录账号
            </label>
            <div className="relative">
              <User
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 z-10"
              />
              <input
                id="login-username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="管理员分配的用户名"
                className="w-full pl-11 pr-4 py-3 bg-slate-800/80 border border-slate-700 rounded-2xl text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="text-sm font-medium text-slate-400 block mb-1.5"
            >
              密码
            </label>
            <div className="relative">
              <Lock
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 z-10"
              />
              <PasswordInput
                id="login-password"
                value={password}
                onChange={setPassword}
                placeholder="请输入登录密码"
                autoComplete="current-password"
                dark
                className="w-full pl-11 py-3 bg-slate-800/80 border border-slate-700 rounded-2xl text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-xl px-3.5 py-2.5"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 min-h-12 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-red-600 font-medium text-slate-950 text-base flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 active:scale-[0.99] disabled:opacity-50 transition"
          >
            <span>{loading ? '登录中…' : '进入大赢家'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-800/80 text-center">
          <p className="text-sm text-slate-400 leading-relaxed">
            💡 微信中可向管理员索取专属免登链接
            <br />
            点开一次即可绑定微信永久免密访问
          </p>
        </div>
      </div>

      {/* 底部版权 */}
      <div className="text-center text-xs text-slate-500 pb-2 short:hidden">
        大赢家 · 零和记账守护者
      </div>
    </div>
  );
}
