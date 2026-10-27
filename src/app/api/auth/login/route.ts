import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createDeviceSession, setDeviceCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }

    const userRes = await query<{
      id: number;
      username: string;
      nickname: string;
      password_hash: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
      bind_token: string | null;
    }>(
      `SELECT id, username, nickname, password_hash, role, avatar_color, is_active, bind_token
       FROM users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [username],
    );

    if (userRes.rowCount === 0) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const userAgent = req.headers.get('user-agent') || '';
    const deviceToken = await createDeviceSession(user.id, userAgent);

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatar_color,
        isActive: user.is_active,
        bindToken: user.bind_token,
      },
      deviceToken,
    });

    setDeviceCookie(res, deviceToken);
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
