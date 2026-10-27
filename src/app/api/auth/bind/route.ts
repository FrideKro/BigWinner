import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createDeviceSession, setDeviceCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bindToken = String(body.bindToken || '').trim();

    if (!bindToken) {
      return NextResponse.json({ error: '缺少专属绑定凭证' }, { status: 400 });
    }

    const userRes = await query<{
      id: number;
      username: string;
      nickname: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
      bind_token: string | null;
    }>(
      `SELECT id, username, nickname, role, avatar_color, is_active, bind_token
       FROM users
       WHERE bind_token = $1
       LIMIT 1`,
      [bindToken],
    );

    if (userRes.rowCount === 0) {
      return NextResponse.json(
        { error: '该专属绑定链接已失效，请联系管理员重新获取' },
        { status: 401 },
      );
    }

    const user = userRes.rows[0];
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
    console.error('Bind error:', error);
    return NextResponse.json({ error: '设备绑定失败，请稍后重试' }, { status: 500 });
  }
}
