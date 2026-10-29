import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withTransaction, generateToken } from '@/lib/db';
import { validateProfileLengths } from '@/lib/profileValidation';
import { withAuth, parseJsonBody, ApiError } from '../../_lib/handler';

export const PATCH = withAuth<{ id: string }>(
  async (req, _user, { params }) => {
    const { id } = await params;
    const targetId = parseInt(id, 10);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    const body = await parseJsonBody(req);

    const nickname = body.nickname !== undefined ? String(body.nickname).trim() : undefined;
    const username = body.username !== undefined ? String(body.username).trim() : undefined;
    const role = body.role !== undefined ? (body.role === 'ADMIN' ? 'ADMIN' : 'PLAYER') : undefined;
    const avatarColor =
      body.avatarColor !== undefined ? String(body.avatarColor).trim() : undefined;
    const isActive = body.isActive !== undefined ? Boolean(body.isActive) : undefined;
    const newPassword = body.password ? String(body.password) : undefined;
    const regenerateBindToken = Boolean(body.regenerateBindToken);
    const revokeDevices = Boolean(body.revokeDevices);

    if (username !== undefined && !username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (nickname !== undefined && !nickname) {
      return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });
    }
    const lengthError = validateProfileLengths({ username, nickname, avatarColor });
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
    if (newPassword !== undefined && newPassword.length < 4) {
      return NextResponse.json({ error: '密码长度至少为 4 位' }, { status: 400 });
    }

    const passwordHash = newPassword !== undefined ? await bcrypt.hash(newPassword, 10) : null;
    const newBindToken = regenerateBindToken ? generateToken(24) : null;

    const u = await withTransaction(async (client) => {
      if (username !== undefined) {
        const dup = await client.query(
          `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2`,
          [username, targetId],
        );
        if ((dup.rowCount ?? 0) > 0) {
          throw new ApiError(409, `登录账号 "${username}" 已被占用`);
        }
      }

      if (role === 'PLAYER') {
        const adminCountRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND id != $1`,
          [targetId],
        );
        const remainingAdmins = parseInt(adminCountRes.rows[0]?.count || '0', 10);
        if (remainingAdmins === 0) {
          throw new ApiError(400, '系统中必须保留至少一位管理员，无法降级');
        }
      }

      // 重置专属绑定链接并清除已绑定设备（可选）
      if (newBindToken) {
        await client.query(`UPDATE users SET bind_token = $1 WHERE id = $2`, [
          newBindToken,
          targetId,
        ]);
        if (revokeDevices) {
          await client.query(`DELETE FROM user_devices WHERE user_id = $1`, [targetId]);
        }
      }

      // 重置密码后下线该用户全部设备，确保旧登录凭据立即失效
      if (passwordHash) {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          passwordHash,
          targetId,
        ]);
        await client.query(`DELETE FROM user_devices WHERE user_id = $1`, [targetId]);
      }

      const updatedRes = await client.query<{
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
        ],
      );

      if (updatedRes.rowCount === 0) {
        throw new ApiError(404, '玩家不存在');
      }
      return updatedRes.rows[0];
    });

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
  },
  { admin: '仅管理员可修改玩家账号', error: '更新玩家信息失败' },
);
