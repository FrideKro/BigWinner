import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { query, generateToken } from './db';

export const DEVICE_COOKIE_NAME = 'bw_device_token';
export const DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 365天

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  role: 'ADMIN' | 'PLAYER';
  avatarColor: string;
  isActive: boolean;
  bindToken: string | null;
  deviceToken: string;
}

export function setDeviceCookie(res: NextResponse, deviceToken: string): void {
  res.cookies.set(DEVICE_COOKIE_NAME, deviceToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: DEVICE_MAX_AGE_SECONDS,
  });
}

export function clearDeviceCookie(res: NextResponse): void {
  res.cookies.set(DEVICE_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 0,
  });
}

export async function createDeviceSession(userId: number, userAgent: string): Promise<string> {
  const deviceToken = generateToken(32);
  // 登录/绑定频率极低，顺带清理已过期 30 天以上的历史设备会话，防止 user_devices 无限增长
  await query(`DELETE FROM user_devices WHERE expires_at < NOW() - INTERVAL '30 days'`);
  await query(
    `INSERT INTO user_devices (user_id, device_token, user_agent, last_seen_at, expires_at)
     VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '365 days')`,
    [userId, deviceToken, (userAgent || '').slice(0, 500)],
  );
  return deviceToken;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const token =
    cookieStore.get(DEVICE_COOKIE_NAME)?.value || headerStore.get('x-device-token') || '';

  if (!token) {
    return null;
  }

  return verifyAndExtendDeviceToken(token);
}

export async function verifyAndExtendDeviceToken(deviceToken: string): Promise<AuthUser | null> {
  if (!deviceToken) return null;

  // 先读后写：认证校验本身是纯读（走 device_token 唯一索引），
  // 避免每个请求都对 user_devices 做一次 UPDATE（WAL 写放大 + 同设备并发请求在行锁上排队）
  const result = await query<{
    id: number;
    username: string;
    nickname: string;
    role: 'ADMIN' | 'PLAYER';
    avatar_color: string;
    is_active: boolean;
    bind_token: string | null;
    device_token: string;
  }>(
    `SELECT u.id, u.username, u.nickname, u.role, u.avatar_color, u.is_active, u.bind_token, ud.device_token
     FROM user_devices AS ud
     JOIN users AS u ON u.id = ud.user_id
     WHERE ud.device_token = $1
       AND ud.expires_at > NOW()`,
    [deviceToken],
  );

  if (result.rowCount === 0) {
    return null;
  }

  // 滑动续期节流：仅当距过期不足 30 天或 last_seen_at 距今超过 1 小时才写库顺延，
  // 365 天滑动语义不变，写频率从每请求一次降到每设备至多每小时一次
  await query(
    `UPDATE user_devices
     SET last_seen_at = NOW(),
         expires_at = NOW() + INTERVAL '365 days'
     WHERE device_token = $1
       AND (expires_at < NOW() + INTERVAL '335 days' OR last_seen_at < NOW() - INTERVAL '1 hour')`,
    [deviceToken],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    avatarColor: row.avatar_color,
    isActive: row.is_active,
    bindToken: row.bind_token,
    deviceToken: row.device_token,
  };
}
