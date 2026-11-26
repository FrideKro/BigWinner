import { cookies, headers } from 'next/headers';
import { createHash, randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { query, generateToken } from './db';
import type { UserRole } from './roles';

export const DEVICE_COOKIE_NAME = 'bw_device_token';
export const DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 365天

// Cookie Secure 标志：HTTPS 部署需设 COOKIE_SECURE=true；兼容 true/1/yes（忽略大小写）
function isCookieSecure(): boolean {
  const value = String(process.env.COOKIE_SECURE || '')
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

// 设备 Token 入库前先做 SHA-256：数据库泄露时无法从库中还原出可用会话凭据
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// 可读的随机密码（默认 12 位，去除 0/o/1/l/I 等易混淆字符）：
// 管理员重置密码时由服务端生成，仅在响应中返回一次，不落日志
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRandomPassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return password;
}

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  role: UserRole;
  avatarColor: string;
  isActive: boolean;
  bindToken: string | null;
  deviceToken: string;
  needsExtend?: boolean;
}

export function setDeviceCookie(res: NextResponse, deviceToken: string): void {
  res.cookies.set(DEVICE_COOKIE_NAME, deviceToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isCookieSecure(),
    maxAge: DEVICE_MAX_AGE_SECONDS,
  });
}

export function clearDeviceCookie(res: NextResponse): void {
  res.cookies.set(DEVICE_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: isCookieSecure(),
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
    [userId, hashToken(deviceToken), (userAgent || '').slice(0, 500)],
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

  const tokenHash = hashToken(deviceToken);

  // 先读后写：认证校验本身是纯读（走 device_token 唯一索引），
  // 避免每个请求都对 user_devices 做一次 UPDATE（WAL 写放大 + 同设备并发请求在行锁上排队）。
  // 停用玩家（is_active = FALSE）在此一并拦截，已发设备立即失效
  const result = await query<{
    id: number;
    username: string;
    nickname: string;
    role: UserRole;
    avatar_color: string;
    is_active: boolean;
    bind_token: string | null;
    device_token: string;
    needs_extend: boolean;
  }>(
    `SELECT u.id, u.username, u.nickname, u.role, u.avatar_color, u.is_active, u.bind_token, ud.device_token,
            (ud.expires_at < NOW() + INTERVAL '335 days' OR ud.last_seen_at < NOW() - INTERVAL '1 hour') AS needs_extend
     FROM user_devices AS ud
     JOIN users AS u ON u.id = ud.user_id
     WHERE ud.device_token = $1
       AND ud.expires_at > NOW()
       AND u.is_active = TRUE`,
    [tokenHash],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  const needsExtend = Boolean(row.needs_extend);

  // 滑动续期节流：仅当距过期不足 30 天或 last_seen_at 距今超过 1 小时才写库顺延，
  // 99%+ 常态请求由 2 次 DB 往返降为 1 次
  if (needsExtend) {
    await query(
      `UPDATE user_devices
       SET last_seen_at = NOW(),
           expires_at = NOW() + INTERVAL '365 days'
       WHERE device_token = $1
         AND (expires_at < NOW() + INTERVAL '335 days' OR last_seen_at < NOW() - INTERVAL '1 hour')`,
      [tokenHash],
    );
  }

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    avatarColor: row.avatar_color,
    isActive: row.is_active,
    bindToken: row.bind_token,
    deviceToken,
    needsExtend,
  };
}
