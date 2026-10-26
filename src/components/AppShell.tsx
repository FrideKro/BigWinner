'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Trophy, ListOrdered, BarChart3, User, Plus } from 'lucide-react';
import { GameEditorModal, PlayerOption } from './GameEditorModal';
import { LogoMark } from './LogoMark';

export interface CurrentUser {
  id: number;
  username: string;
  nickname: string;
  role: 'ADMIN' | 'PLAYER';
  avatarColor: string;
  isActive: boolean;
  bindToken?: string | null;
}

interface AppContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  openGameEditor: () => void;
  gameSavedVersion: number;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => {},
  logout: async () => {},
  openGameEditor: () => {},
  gameSavedVersion: 0,
});

export function useApp() {
  return useContext(AppContext);
}

const LS_DEVICE_TOKEN = 'bw_device_token';

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // 全局记账弹窗控制
  const [editorOpen, setEditorOpen] = useState(false);
  const [gameSavedVersion, setGameSavedVersion] = useState(0);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [defaultRoomFee, setDefaultRoomFee] = useState(100);

  const isPublicPage = pathname === '/login' || pathname === '/bind';

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.deviceToken) {
          try {
            localStorage.setItem(LS_DEVICE_TOKEN, data.deviceToken);
          } catch {
            /* ignore */
          }
        }
        return data.user as CurrentUser;
      }

      // Cookie 失效 → 尝试 LocalStorage 自愈
      const backup = localStorage.getItem(LS_DEVICE_TOKEN);
      if (backup) {
        const restoreRes = await fetch('/api/auth/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceToken: backup }),
        });
        if (restoreRes.ok) {
          const data = await restoreRes.json();
          setUser(data.user);
          return data.user as CurrentUser;
        }
        localStorage.removeItem(LS_DEVICE_TOKEN);
      }

      setUser(null);
      return null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPlayersAndSettings = useCallback(async () => {
    try {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/settings'),
      ]);
      if (uRes.ok) {
        const udata = await uRes.json();
        setPlayers(
          udata.users.map((u: { id: number; nickname: string; avatarColor: string; isActive: boolean }) => ({
            id: u.id,
            nickname: u.nickname,
            avatarColor: u.avatarColor,
            isActive: u.isActive,
          }))
        );
      }
      if (sRes.ok) {
        const sdata = await sRes.json();
        setDefaultRoomFee(sdata.defaultRoomFee || 100);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (user) {
      loadPlayersAndSettings();
    }
  }, [user, loadPlayersAndSettings]);

  // 受保护页面未登录 → 跳登录
  useEffect(() => {
    if (!loading && !user && !isPublicPage) {
      router.replace('/login');
    }
    if (!loading && user && pathname === '/login') {
      router.replace('/');
    }
  }, [loading, user, isPublicPage, pathname, router]);

  const logout = useCallback(async () => {
    const backup = localStorage.getItem(LS_DEVICE_TOKEN);
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: backup }),
    }).catch(() => {});
    localStorage.removeItem(LS_DEVICE_TOKEN);
    setUser(null);
    router.replace('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    await fetchMe();
    await loadPlayersAndSettings();
  }, [fetchMe, loadPlayersAndSettings]);

  const openGameEditor = useCallback(() => {
    if (user?.role !== 'ADMIN') {
      alert('仅管理员可以录入战绩');
      return;
    }
    loadPlayersAndSettings();
    setEditorOpen(true);
  }, [user, loadPlayersAndSettings]);

  const handleGameSaved = useCallback(() => {
    setEditorOpen(false);
    setGameSavedVersion((v) => v + 1);
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        loading,
        refreshUser,
        logout,
        openGameEditor,
        gameSavedVersion,
      }}
    >
      <div className="min-h-screen bg-slate-100 max-w-lg sm:max-w-xl md:max-w-2xl lg:max-w-4xl mx-auto relative shadow-2xl">
        {loading && !isPublicPage ? (
          <div className="h-screen flex flex-col items-center justify-center gap-3">
            <LogoMark size={56} className="animate-pulse drop-shadow-lg" />
            <span className="text-slate-400 text-sm">加载中…</span>
          </div>
        ) : user && !isPublicPage ? (
          <>
            <main className="pb-24 md:pb-28">{children}</main>
            <BottomNav
              pathname={pathname}
              isAdmin={user.role === 'ADMIN'}
              onRecordClick={openGameEditor}
            />
            {user.role === 'ADMIN' && (
              <GameEditorModal
                open={editorOpen}
                players={players}
                defaultRoomFee={defaultRoomFee}
                onClose={() => setEditorOpen(false)}
                onSaved={handleGameSaved}
              />
            )}
          </>
        ) : (
          <>{children}</>
        )}
      </div>
    </AppContext.Provider>
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
  const router = useRouter();

  return (
    <nav className="fixed bottom-0 md:bottom-5 left-1/2 -translate-x-1/2 w-full max-w-lg md:max-w-2xl bg-white/95 backdrop-blur border-t md:border md:border-slate-200/70 z-40 pb-[env(safe-area-inset-bottom)] md:pb-0 md:rounded-3xl md:shadow-xl md:shadow-slate-900/10">
      <div className="flex items-center justify-between h-14 md:h-16 px-2 md:px-4">
        {/* 左侧 1: 总榜 */}
        <button
          onClick={() => router.push('/')}
          className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition ${
            pathname === '/' ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          <Trophy size={19} strokeWidth={pathname === '/' ? 2.5 : 2} />
          <span className={`text-xs ${pathname === '/' ? 'font-medium' : ''}`}>
            总榜
          </span>
        </button>

        {/* 左侧 2: 流水 */}
        <button
          onClick={() => router.push('/games')}
          className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition ${
            pathname.startsWith('/games') ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          <ListOrdered
            size={19}
            strokeWidth={pathname.startsWith('/games') ? 2.5 : 2}
          />
          <span
            className={`text-xs ${
              pathname.startsWith('/games') ? 'font-medium' : ''
            }`}
          >
            流水
          </span>
        </button>

        {/* 中间核心: 记一局 */}
        <div className="flex-1 flex flex-col items-center justify-center relative -top-3">
          <button
            onClick={onRecordClick}
            className="h-12 w-12 p-3 rounded-full bg-gradient-to-tr from-amber-500 via-rose-600 to-red-600 text-white flex items-center justify-center shadow-lg shadow-red-500/35 border-4 border-white active:scale-90 transition-transform"
            title={isAdmin ? '记一局' : '仅管理员可记账'}
          >
            <Plus size={24} strokeWidth={3} />
          </button>
          <span className="text-xs font-medium text-red-600 mt-0.5">
            记一局
          </span>
        </div>

        {/* 右侧 1: 看板 */}
        <button
          onClick={() => router.push('/stats')}
          className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition ${
            pathname.startsWith('/stats') ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          <BarChart3
            size={19}
            strokeWidth={pathname.startsWith('/stats') ? 2.5 : 2}
          />
          <span
            className={`text-xs ${
              pathname.startsWith('/stats') ? 'font-medium' : ''
            }`}
          >
            看板
          </span>
        </button>

        {/* 右侧 2: 我的 */}
        <button
          onClick={() => router.push('/profile')}
          className={`flex-1 flex flex-col items-center justify-center py-1 gap-0.5 transition ${
            pathname.startsWith('/profile') ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          <User
            size={19}
            strokeWidth={pathname.startsWith('/profile') ? 2.5 : 2}
          />
          <span
            className={`text-xs ${
              pathname.startsWith('/profile') ? 'font-medium' : ''
            }`}
          >
            我的
          </span>
        </button>
      </div>
    </nav>
  );
}
