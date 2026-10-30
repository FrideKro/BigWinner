'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Trophy, ListOrdered, BarChart3, User, Plus } from 'lucide-react';
import { LogoMark } from './LogoMark';
import { Toast } from './Toast';
import { invalidateApiCache, isAbortError } from '@/lib/apiClient';

const GameEditorModal = dynamic(() => import('./GameEditorModal').then((m) => m.GameEditorModal), {
  ssr: false,
});

export interface CurrentUser {
  id: number;
  username: string;
  nickname: string;
  role: 'ADMIN' | 'PLAYER';
  avatarColor: string;
  isActive: boolean;
}

export interface PlayerListItem {
  id: number;
  nickname: string;
  avatarColor: string;
  isActive: boolean;
  // 仅管理员返回
  username?: string;
  role?: 'ADMIN' | 'PLAYER';
  bindToken?: string | null;
  deviceCount?: number;
  createdAt?: string;
}

interface BootstrapPayload {
  user: CurrentUser;
  players: PlayerListItem[];
  defaultRoomFee: number;
  passwordLoginEnabled: boolean;
  deviceToken?: string;
}

interface AppContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refreshUser: () => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
  openGameEditor: () => void;
  gameSavedVersion: number;
  /** 全量玩家列表（含隐藏），供看板选人条、记账弹窗等复用 */
  players: PlayerListItem[];
  defaultRoomFee: number;
  /** 普通玩家是否允许账号密码登录（管理员始终可登录） */
  passwordLoginEnabled: boolean;
  showToast: (message: string) => void;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => null,
  logout: async () => {},
  openGameEditor: () => {},
  gameSavedVersion: 0,
  players: [],
  defaultRoomFee: 100,
  passwordLoginEnabled: false,
  showToast: () => {},
});

export function useApp() {
  return useContext(AppContext);
}

const LS_DEVICE_TOKEN = 'bw_device_token';
const SESSION_EXPIRED_KEY = 'bw_session_expired';

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  // 网络异常 / 服务端不可用标记：此时不清空登录态、不误跳登录页
  const [offline, setOffline] = useState(false);

  // 全局记账弹窗控制
  const [editorOpen, setEditorOpen] = useState(false);
  const [gameSavedVersion, setGameSavedVersion] = useState(0);
  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [defaultRoomFee, setDefaultRoomFee] = useState(100);
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 公开页：登录页、微信免登绑定页、免登录分享页（/s/{code}）
  const isPublicPage = pathname === '/login' || pathname === '/bind' || pathname.startsWith('/s/');

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const applyBootstrap = useCallback((data: BootstrapPayload) => {
    setUser(data.user);
    setPlayers(data.players || []);
    setDefaultRoomFee(data.defaultRoomFee ?? 100);
    setPasswordLoginEnabled(Boolean(data.passwordLoginEnabled));
    if (data.deviceToken) {
      try {
        localStorage.setItem(LS_DEVICE_TOKEN, data.deviceToken);
      } catch {
        /* ignore */
      }
    }
  }, []);

  /**
   * 冷启动聚合加载：一次请求拿到用户 + 玩家列表 + 默认房费。
   * 401 时尝试用 LocalStorage 设备令牌自愈；网络异常保留当前登录态。
   */
  const loadBootstrap = useCallback(
    async (options: { force?: boolean; silent?: boolean } = {}): Promise<CurrentUser | null> => {
      const { silent = false } = options;
      if (!silent) setLoading(true);

      try {
        const res = await fetch('/api/bootstrap', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as BootstrapPayload;
          applyBootstrap(data);
          setOffline(false);
          return data.user;
        }

        if (res.status !== 401) {
          setOffline(true);
          return null;
        }

        // Cookie 失效 → 尝试 LocalStorage 自愈
        let backup: string | null = null;
        try {
          backup = localStorage.getItem(LS_DEVICE_TOKEN);
        } catch {
          backup = null;
        }

        if (backup) {
          const restoreRes = await fetch('/api/auth/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceToken: backup }),
          });
          if (restoreRes.ok) {
            const retry = await fetch('/api/bootstrap', { cache: 'no-store' });
            if (retry.ok) {
              const data = (await retry.json()) as BootstrapPayload;
              applyBootstrap(data);
              setOffline(false);
              return data.user;
            }
          }
          try {
            localStorage.removeItem(LS_DEVICE_TOKEN);
          } catch {
            /* ignore */
          }
        }

        setUser(null);
        setPlayers([]);
        setDefaultRoomFee(100);
        setPasswordLoginEnabled(false);
        setOffline(false);
        return null;
      } catch (err) {
        if (isAbortError(err)) return null;
        // 网络异常：不清空用户、不触发跳转登录页
        setOffline(true);
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyBootstrap],
  );

  // 公开页（登录/绑定/分享）不消费登录态，跳过冷启动聚合，省一次必 401 的请求；
  // 导航回受保护页时本 effect 因 pathname 变化重跑、正常加载
  useEffect(() => {
    if (isPublicPage) {
      setLoading(false);
      return;
    }
    void loadBootstrap();
  }, [loadBootstrap, isPublicPage]);

  // 受保护页面未登录 → 跳登录（网络异常时除外，展示重连提示）
  useEffect(() => {
    if (!loading && !user && !isPublicPage && !offline) {
      router.replace('/login');
    }
    if (!loading && user && pathname === '/login') {
      router.replace('/');
    }
  }, [loading, user, isPublicPage, offline, pathname, router]);

  // 任意页面接口返回 401 → 统一清理登录态并回登录页
  useEffect(() => {
    const onUnauthorized = () => {
      try {
        sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
      } catch {
        /* ignore */
      }
      invalidateApiCache();
      setUser(null);
      setPlayers([]);
      setPasswordLoginEnabled(false);
      if (pathname !== '/login' && pathname !== '/bind' && !pathname.startsWith('/s/')) {
        router.replace('/login');
      }
    };
    window.addEventListener('bw:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bw:unauthorized', onUnauthorized);
  }, [pathname, router]);

  const logout = useCallback(async () => {
    let backup: string | null = null;
    try {
      backup = localStorage.getItem(LS_DEVICE_TOKEN);
    } catch {
      backup = null;
    }
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: backup }),
    }).catch(() => {});
    try {
      localStorage.removeItem(LS_DEVICE_TOKEN);
    } catch {
      /* ignore */
    }
    invalidateApiCache();
    setUser(null);
    setPlayers([]);
    router.replace('/login');
  }, [router]);

  const refreshUser = useCallback(
    () => loadBootstrap({ force: true, silent: true }),
    [loadBootstrap],
  );

  const openGameEditor = useCallback(() => {
    if (user?.role !== 'ADMIN') {
      showToast('仅管理员可以录入战绩');
      return;
    }
    setEditorOpen(true);
    // 后台刷新玩家列表，弹窗通过 context 自动同步，不再单独发请求
    void loadBootstrap({ force: true, silent: true });
  }, [user, loadBootstrap, showToast]);

  const handleGameSaved = useCallback(() => {
    setEditorOpen(false);
    invalidateApiCache();
    setGameSavedVersion((v) => v + 1);
    showToast('已记账');
  }, [showToast]);

  // 管理员空闲时预取记账弹窗代码，首次点“记一局”无需等待 chunk
  useEffect(() => {
    if (user?.role === 'ADMIN') {
      void import('./GameEditorModal');
    }
  }, [user]);

  const contextValue = useMemo<AppContextValue>(
    () => ({
      user,
      loading,
      refreshUser,
      logout,
      openGameEditor,
      gameSavedVersion,
      players,
      defaultRoomFee,
      passwordLoginEnabled,
      showToast,
    }),
    [
      user,
      loading,
      refreshUser,
      logout,
      openGameEditor,
      gameSavedVersion,
      players,
      defaultRoomFee,
      passwordLoginEnabled,
      showToast,
    ],
  );

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-slate-100 max-w-lg sm:max-w-xl md:max-w-2xl lg:max-w-4xl mx-auto relative shadow-2xl">
        {loading && !isPublicPage ? (
          <div className="h-screen flex flex-col items-center justify-center gap-3">
            <LogoMark size={56} className="animate-pulse drop-shadow-lg" />
            <span className="text-slate-500 text-sm">加载中…</span>
          </div>
        ) : offline && !user && !isPublicPage ? (
          <div className="h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
            <LogoMark size={48} className="opacity-40" />
            <div className="text-sm text-slate-600">网络连接失败，请检查网络后重试</div>
            <button
              onClick={() => {
                setOffline(false);
                setLoading(true);
                void loadBootstrap();
              }}
              className="min-h-11 px-6 rounded-xl bg-slate-900 text-white text-sm font-medium active:scale-[0.98] transition"
            >
              重新连接
            </button>
          </div>
        ) : user && !isPublicPage ? (
          <>
            {offline && (
              <div
                role="status"
                className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800"
              >
                网络连接异常，当前显示上次数据
              </div>
            )}
            <main className="pb-24 md:pb-28">{children}</main>
            <BottomNav
              pathname={pathname}
              isAdmin={user.role === 'ADMIN'}
              onRecordClick={openGameEditor}
            />
            {user.role === 'ADMIN' && editorOpen && (
              <GameEditorModal
                open
                players={players}
                defaultRoomFee={defaultRoomFee}
                onClose={() => setEditorOpen(false)}
                onSaved={handleGameSaved}
              />
            )}
          </>
        ) : !isPublicPage ? (
          // 未登录的受保护页面：等待重定向到登录页，避免先挂载页面再发 401 请求
          <div className="h-screen flex flex-col items-center justify-center gap-3">
            <LogoMark size={48} className="opacity-40" />
            <span className="text-slate-500 text-sm">正在跳转登录…</span>
          </div>
        ) : (
          <>{children}</>
        )}
      </div>
      {toast && <Toast message={toast} />}
    </AppContext.Provider>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition ${
        active ? 'text-red-600' : 'text-slate-500'
      }`}
    >
      <Icon size={19} strokeWidth={active ? 2.5 : 2} />
      <span className={`text-xs ${active ? 'font-medium' : ''}`}>{label}</span>
    </Link>
  );
}

function BottomNav({
  pathname,
  isAdmin,
  onRecordClick,
}: {
  pathname: string;
  isAdmin: boolean;
  onRecordClick: () => void;
}) {
  return (
    <nav className="fixed bottom-0 md:bottom-5 left-1/2 -translate-x-1/2 w-full max-w-lg md:max-w-2xl bg-white/95 backdrop-blur border-t md:border md:border-slate-200/70 z-40 pb-[env(safe-area-inset-bottom)] md:pb-0 md:rounded-3xl md:shadow-xl md:shadow-slate-900/10">
      <div className="flex items-center justify-between h-14 md:h-16 px-2 md:px-4">
        <NavLink href="/" label="总榜" icon={Trophy} active={pathname === '/'} />
        <NavLink
          href="/games"
          label="流水"
          icon={ListOrdered}
          active={pathname.startsWith('/games')}
        />

        {isAdmin && (
          <div className="flex-1 flex flex-col items-center justify-center relative -top-3">
            <button
              onClick={onRecordClick}
              aria-label="记一局"
              className="h-12 w-12 p-3 rounded-full bg-gradient-to-tr from-amber-500 via-rose-600 to-red-600 text-white flex items-center justify-center shadow-lg shadow-red-500/35 border-4 border-white active:scale-90 transition-transform"
            >
              <Plus size={24} strokeWidth={3} />
            </button>
            <span className="text-xs font-medium text-red-600 mt-0.5">记一局</span>
          </div>
        )}

        <NavLink
          href="/stats"
          label="看板"
          icon={BarChart3}
          active={pathname.startsWith('/stats')}
        />
        <NavLink
          href="/profile"
          label="我的"
          icon={User}
          active={pathname.startsWith('/profile')}
        />
      </div>
    </nav>
  );
}
