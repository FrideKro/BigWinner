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
    `UPDATE user_devices AS ud
     SET last_seen_at = NOW(),
         expires_at = NOW() + INTERVAL '365 days'
     FROM users AS u
     WHERE ud.user_id = u.id
       AND ud.device_token = $1
       AND ud.expires_at > NOW()
     RETURNING u.id, u.username, u.nickname, u.role, u.avatar_color, u.is_active, u.bind_token, ud.device_token`,
    [deviceToken],
  );

  if (result.rowCount === 0) {
    return null;
  }

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
