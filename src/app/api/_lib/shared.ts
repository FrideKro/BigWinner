import { query } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';
import type { PoolClient } from 'pg';
import { ApiError } from './handler';

export interface PlayerListItem {
  id: number;
  nickname: string;
  avatarColor: string;
  isActive: boolean;
  /** 头像版本号：设置/清除头像时 +1，客户端据此判断本地缓存头像是否失效 */
  avatarVersion?: number;
  // 以下字段仅管理员可见
  username?: string;
  role?: 'ADMIN' | 'PLAYER';
  bindToken?: string | null;
  deviceCount?: number;
  createdAt?: string;
}

export interface PublicUser {
  id: number;
  username: string;
  nickname: string;
  role: 'ADMIN' | 'PLAYER';
  avatarColor: string;
  isActive: boolean;
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
  };
}

/**
 * 玩家列表按角色裁剪字段：
 * - 管理员：含登录账号、绑定令牌、设备数，供管理台使用
 * - 普通玩家：仅昵称/头像/显示状态，避免手机号等敏感信息泄露
 */
export async function listPlayers(user: AuthUser): Promise<PlayerListItem[]> {
  if (user.role !== 'ADMIN') {
    const res = await query<{
      id: number;
      nickname: string;
      avatar_color: string;
      avatar_version: number;
      is_active: boolean;
    }>(
      `SELECT id, nickname, avatar_color, avatar_version, is_active
       FROM users
       ORDER BY is_active DESC, id ASC`,
    );
    return res.rows.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatarColor: u.avatar_color,
      avatarVersion: u.avatar_version,
      isActive: u.is_active,
    }));
  }

  const res = await query<{
    id: number;
    username: string;
    nickname: string;
    role: 'ADMIN' | 'PLAYER';
    avatar_color: string;
    avatar_version: number;
    is_active: boolean;
    bind_token: string | null;
    created_at: string;
    device_count: string;
  }>(
    `SELECT u.id,
            u.username,
            u.nickname,
            u.role,
            u.avatar_color,
            u.avatar_version,
            u.is_active,
            u.bind_token,
            u.created_at,
            COUNT(ud.id) FILTER (WHERE ud.expires_at > NOW())::text AS device_count
     FROM users u
     LEFT JOIN user_devices ud ON ud.user_id = u.id
     GROUP BY u.id
     ORDER BY u.is_active DESC, u.id ASC`,
  );

  return res.rows.map((u) => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role,
    avatarColor: u.avatar_color,
    avatarVersion: u.avatar_version,
    isActive: u.is_active,
    bindToken: u.bind_token,
    deviceCount: parseInt(u.device_count || '0', 10),
    createdAt: u.created_at,
  }));
}

export async function getDefaultRoomFee(): Promise<number> {
  const res = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key = 'default_room_fee'`,
  );
  const value = parseInt(res.rows[0]?.value || '100', 10);
  return Number.isNaN(value) ? 100 : value;
}

// 玩家密码登录开关：默认关闭，普通玩家只能通过免登链接绑定后访问
export async function getPasswordLoginEnabled(): Promise<boolean> {
  const res = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'password_login_enabled'`,
  );
  return res.rows[0]?.value === 'true';
}

// 校验本场全部玩家存在，避免命中外键约束后返回不友好的 500。
// 默认要求全部玩家处于启用状态（新建场次口径）；编辑历史场次时通过
// allowInactiveUserIds 放行原对局已有的玩家，避免停用玩家卡死历史对局编辑
export async function assertRecordsUsersExist(
  client: PoolClient,
  userIds: number[],
  options: { allowInactiveUserIds?: number[] } = {},
): Promise<void> {
  const found = await client.query<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM users WHERE id = ANY($1)`,
    [userIds],
  );
  if ((found.rowCount ?? 0) !== userIds.length) {
    throw new ApiError(400, '包含无效的玩家，请刷新玩家列表后重试');
  }
  if (options.allowInactiveUserIds) {
    const allowed = new Set(options.allowInactiveUserIds);
    if (found.rows.some((r) => !r.is_active && !allowed.has(r.id))) {
      throw new ApiError(400, '包含不可用的玩家，请刷新玩家列表后重试');
    }
    return;
  }
  if (found.rows.some((r) => !r.is_active)) {
    throw new ApiError(400, '包含不可用的玩家，请刷新玩家列表后重试');
  }
}
