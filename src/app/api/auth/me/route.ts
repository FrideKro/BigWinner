import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { getCurrentUser, setDeviceCookie } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const devicesRes = await query<{
      id: number;
      user_agent: string;
      last_seen_at: string;
      created_at: string;
      is_current: boolean;
    }>(
      `SELECT id,
              user_agent,
              last_seen_at,
              created_at,
              (device_token = $2) AS is_current
       FROM user_devices
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY last_seen_at DESC
       LIMIT 10`,
      [user.id, user.deviceToken],
    );

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatarColor,
        isActive: user.isActive,
        bindToken: user.bindToken,
      },
      deviceToken: user.deviceToken,
      devices: devicesRes.rows.map((d) => ({
        id: d.id,
        userAgent: d.user_agent,
        lastSeenAt: d.last_seen_at,
        createdAt: d.created_at,
        isCurrent: d.is_current,
      })),
    });

    // 每次访问自动顺延 Cookie 有效期 365 天
    setDeviceCookie(res, user.deviceToken);
    return res;
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json({ error: '获取用户信息失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await req.json();
    const nickname = body.nickname !== undefined ? String(body.nickname).trim() : undefined;
    const avatarColor =
      body.avatarColor !== undefined ? String(body.avatarColor).trim() : undefined;
    const currentPassword = body.currentPassword ? String(body.currentPassword) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    if (nickname !== undefined && !nickname) {
      return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });
    }

    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: '修改密码必须输入当前原密码' }, { status: 400 });
      }
      if (newPassword.length < 4) {
        return NextResponse.json({ error: '新密码长度至少 4 位' }, { status: 400 });
      }
      const pwRes = await query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.id],
      );
      const match = await bcrypt.compare(currentPassword, pwRes.rows[0]?.password_hash || '');
      if (!match) {
        return NextResponse.json({ error: '原密码不正确' }, { status: 400 });
      }
      const newHash = await bcrypt.hash(newPassword, 10);
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, user.id]);
    }

    if (nickname !== undefined || avatarColor !== undefined) {
      await query(
        `UPDATE users
         SET nickname = COALESCE($1, nickname),
             avatar_color = COALESCE($2, avatar_color)
         WHERE id = $3`,
        [nickname ?? null, avatarColor ?? null, user.id],
      );
    }

    const updated = await getCurrentUser();
    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: '更新个人资料失败' }, { status: 500 });
  }
}
