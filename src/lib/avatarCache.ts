// 头像本地缓存：bootstrap 的 players 只下发 avatar_version（小整数），
// data URL 按 userId 缓存在 localStorage，版本一致零请求、不一致才按需拉取。
// 每次写入都递增版本（设置/清除都算变更），因此缓存条目天然带失效判断依据

export interface AvatarCacheEntry {
  /** 产生 src 时的头像版本号 */
  v: number;
  /** data URL；null = 该版本下确认无头像（负缓存，避免无头像玩家每次冷启动都重拉） */
  src: string | null;
}

export type AvatarCache = Record<string, AvatarCacheEntry>;

export interface AvatarSyncItem {
  id: number;
  /** bootstrap 下发的期望版本，同时用作拉取 URL 的缓存键 */
  version: number;
}

const LS_KEY = 'bw_avatar_cache';

/** 读取本地缓存；坏数据（旧版本格式、被改写）整体弃用，等价于全量重新同步 */
export function loadAvatarCache(): AvatarCache {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AvatarCache = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<AvatarCacheEntry> | null;
      if (
        entry &&
        typeof entry.v === 'number' &&
        (typeof entry.src === 'string' || entry.src === null)
      ) {
        out[key] = { v: entry.v, src: entry.src };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 持久化缓存；容量满 / 隐私模式等失败静默放弃，本次会话仍走内存 */
export function saveAvatarCache(cache: AvatarCache): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/** 找出本地缓存缺失或版本已过期的玩家，返回待拉取列表 */
export function diffAvatarVersions(
  players: Array<{ id: number; avatarVersion?: number }>,
  cache: AvatarCache,
): AvatarSyncItem[] {
  const need: AvatarSyncItem[] = [];
  for (const p of players) {
    const version = p.avatarVersion ?? 0;
    const entry = cache[String(p.id)];
    if (!entry || entry.v !== version) {
      need.push({ id: p.id, version });
    }
  }
  return need;
}

/** 单个拉取结果写入缓存（返回新对象，保持不可变更新） */
export function putAvatar(
  cache: AvatarCache,
  userId: number,
  version: number,
  src: string | null,
): AvatarCache {
  return { ...cache, [String(userId)]: { v: version, src } };
}

/** 由缓存构建当前 players 的 userId → data URL 映射；无头像的不入表，落字母主题色头像 */
export function avatarMapFromCache(
  players: Array<{ id: number }>,
  cache: AvatarCache,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const p of players) {
    const src = cache[String(p.id)]?.src;
    if (src) map.set(p.id, src);
  }
  return map;
}
