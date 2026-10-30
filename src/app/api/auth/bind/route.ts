import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createDeviceSession, getCurrentUser, setDeviceCookie } from '@/lib/auth';
import { clearFailures, getClientIp, getRateLimitState, recordFailure } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bindToken = String(body.bindToken || '').trim();

    if (!bindToken) {
      return NextResponse.json({ error: '缺少专属绑定凭证' }, { status: 400 });
    }

    const ipKey = `bind:ip:${getClientIp(req.headers)}`;
    const limitState = getRateLimitState(ipKey);
    if (limitState.locked) {
      const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `尝试次数过多，请约 ${minutes} 分钟后再试` },
        { status: 429 },
      );
    }

    const userRes = await query<{
      id: number;
      username: string;
      nickname: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
    }>(
      `SELECT id, username, nickname, role, avatar_color, is_active
       FROM users
       WHERE bind_token = $1
       LIMIT 1`,
      [bindToken],
    );

    if (userRes.rowCount === 0) {
      recordFailure(ipKey, 10);
      return NextResponse.json(
        { error: '该专属绑定链接已失效，请联系管理员重新获取' },
        { status: 401 },
      );
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      recordFailure(ipKey, 10);
      return NextResponse.json(
        { error: '该账号已停用，请联系管理员重新获取链接' },
        { status: 401 },
      );
    }

    clearFailures(ipKey);

    // 若当前请求已持有同一用户的有效设备会话，直接复用，避免每次点开链接都向 user_devices 插入新行
    const currentUser = await getCurrentUser();
    const userAgent = req.headers.get('user-agent') || '';
    const deviceToken =
      currentUser?.id === user.id
        ? currentUser.deviceToken
        : await createDeviceSession(user.id, userAgent);

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatar_color,
        isActive: user.is_active,
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
