import { query } from '@/lib/db';
import type { AuthUser } from '@/lib/auth';

export interface PlayerListItem {
  id: number;
  nickname: string;
  avatarColor: string;
  isActive: boolean;
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
  bindToken: string | null;
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
    bindToken: user.bindToken,
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
      is_active: boolean;
    }>(
      `SELECT id, nickname, avatar_color, is_active
       FROM users
       ORDER BY is_active DESC, id ASC`,
    );
    return res.rows.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatarColor: u.avatar_color,
      isActive: u.is_active,
    }));
  }

  const res = await query<{
    id: number;
    username: string;
    nickname: string;
    role: 'ADMIN' | 'PLAYER';
    avatar_color: string;
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
