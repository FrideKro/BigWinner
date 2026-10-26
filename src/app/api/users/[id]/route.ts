import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, generateToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可修改玩家账号' }, { status: 403 });
    }

    const { id } = await context.params;
    const targetId = parseInt(id, 10);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    const body = await req.json();

    // 重置专属绑定链接并清除已绑定设备（可选）
    if (body.regenerateBindToken) {
      const newToken = generateToken(24);
      await query(`UPDATE users SET bind_token = $1 WHERE id = $2`, [
        newToken,
        targetId,
      ]);
      if (body.revokeDevices) {
        await query(`DELETE FROM user_devices WHERE user_id = $1`, [targetId]);
      }
    }

    // 重置密码
    if (body.password) {
      const newPassword = String(body.password);
      if (newPassword.length < 4) {
        return NextResponse.json(
          { error: '密码长度至少为 4 位' },
          { status: 400 }
        );
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
        passwordHash,
        targetId,
      ]);
    }

    const nickname =
      body.nickname !== undefined ? String(body.nickname).trim() : undefined;
    const username =
      body.username !== undefined ? String(body.username).trim() : undefined;
    const role =
      body.role !== undefined
        ? body.role === 'ADMIN'
          ? 'ADMIN'
          : 'PLAYER'
        : undefined;
    const avatarColor =
      body.avatarColor !== undefined
        ? String(body.avatarColor).trim()
        : undefined;
    const isActive =
      body.isActive !== undefined ? Boolean(body.isActive) : undefined;

    if (username !== undefined && !username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (nickname !== undefined && !nickname) {
      return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });
    }

    if (username !== undefined) {
      const dup = await query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2`,
        [username, targetId]
      );
      if ((dup.rowCount ?? 0) > 0) {
        return NextResponse.json(
          { error: `登录账号 "${username}" 已被占用` },
          { status: 409 }
        );
      }
    }

    if (role === 'PLAYER') {
      const adminCountRes = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND id != $1`,
        [targetId]
      );
      const remainingAdmins = parseInt(adminCountRes.rows[0]?.count || '0', 10);
      if (remainingAdmins === 0) {
        return NextResponse.json(
          { error: '系统中必须保留至少一位管理员，无法降级' },
          { status: 400 }
        );
      }
    }

    const updatedRes = await query<{
      id: number;
      username: string;
      nickname: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
      bind_token: string | null;
      created_at: string;
    }>(
      `UPDATE users
       SET username = COALESCE($1, username),
           nickname = COALESCE($2, nickname),
           role = COALESCE($3, role),
           avatar_color = COALESCE($4, avatar_color),
           is_active = COALESCE($5, is_active)
       WHERE id = $6
       RETURNING id, username, nickname, role, avatar_color, is_active, bind_token, created_at`,
      [
        username ?? null,
        nickname ?? null,
        role ?? null,
        avatarColor ?? null,
        isActive ?? null,
        targetId,
      ]
    );

    if (updatedRes.rowCount === 0) {
      return NextResponse.json({ error: '玩家不存在' }, { status: 404 });
    }

    const u = updatedRes.rows[0];
    return NextResponse.json({
      user: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        role: u.role,
        avatarColor: u.avatar_color,
        isActive: u.is_active,
        bindToken: u.bind_token,
        createdAt: u.created_at,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: '更新玩家信息失败' }, { status: 500 });
  }
}
