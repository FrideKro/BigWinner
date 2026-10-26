'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

function BindContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useApp();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('正在为您绑定微信免密访问…');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('缺少绑定凭证，请联系管理员重新获取专属链接');
      return;
    }

    async function doBind() {
      try {
        const res = await fetch('/api/auth/bind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bindToken: token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || '绑定失败');
          return;
        }

        if (data.deviceToken) {
          try {
            localStorage.setItem('bw_device_token', data.deviceToken);
          } catch {
            /* ignore */
          }
        }

        setStatus('success');
        setMessage(`欢迎【${data.user?.nickname}】，微信绑定成功！即将进入系统…`);
        await refreshUser();
        setTimeout(() => {
          router.replace('/');
        }, 1200);
      } catch {
        setStatus('error');
        setMessage('网络连接失败，请稍后刷新重试');
      }
    }

    doBind();
  }, [searchParams, refreshUser, router]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
        {status === 'loading' && (
          <div className="space-y-4">
            <Loader2 size={48} className="text-amber-400 animate-spin mx-auto" />
            <h2 className="text-lg font-bold">微信免登绑定中</h2>
            <p className="text-xs text-slate-400">{message}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <CheckCircle2 size={48} className="text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold text-emerald-300">绑定成功</h2>
            <p className="text-xs text-slate-300">{message}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <AlertCircle size={48} className="text-rose-400 mx-auto" />
            <h2 className="text-lg font-bold text-rose-300">绑定失败</h2>
            <p className="text-xs text-slate-400">{message}</p>
            <button
              onClick={() => router.replace('/login')}
              className="mt-4 px-6 py-2.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-200"
            >
              使用账号密码登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BindPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-sm">
          加载中…
        </div>
      }
    >
      <BindContent />
    </Suspense>
  );
}
