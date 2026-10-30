import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, withTransaction, generateToken } from '@/lib/db';
import { setDeviceCookie, getCurrentUser, hashToken } from '@/lib/auth';
import { validatePassword, validateProfileLengths } from '@/lib/profileValidation';
import { withAuth, parseJsonBody } from '../../_lib/handler';
import { toPublicUser } from '../../_lib/shared';

export const GET = withAuth(
  async (_req, user) => {
    const res = NextResponse.json({
      user: toPublicUser(user),
      deviceToken: user.deviceToken,
    });

    // 每次访问自动顺延 Cookie 有效期 365 天
    setDeviceCookie(res, user.deviceToken);
    return res;
  },
  { error: '获取用户信息失败' },
);

export const PATCH = withAuth(
  async (req, user) => {
    const body = await parseJsonBody(req);
    const nickname = body.nickname !== undefined ? String(body.nickname).trim() : undefined;
    const avatarColor =
      body.avatarColor !== undefined ? String(body.avatarColor).trim() : undefined;
    const currentPassword = body.currentPassword ? String(body.currentPassword) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    if (nickname !== undefined && !nickname) {
      return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });
    }

    const lengthError = validateProfileLengths({ nickname, avatarColor });
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }

    let newHash: string | null = null;
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: '修改密码必须输入当前原密码' }, { status: 400 });
      }
      const passwordError = validatePassword(newPassword, '新密码');
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      const pwRes = await query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.id],
      );
      const match = await bcrypt.compare(currentPassword, pwRes.rows[0]?.password_hash || '');
      if (!match) {
        return NextResponse.json({ error: '原密码不正确' }, { status: 400 });
      }
      newHash = await bcrypt.hash(newPassword, 10);
    }

    if (newHash || nickname !== undefined || avatarColor !== undefined) {
      // 密码与资料同一事务提交；改密码后轮换 bind_token 并下线其他设备，保留当前设备避免把自己登出
      await withTransaction(async (client) => {
        if (newHash) {
          await client.query(`UPDATE users SET password_hash = $1, bind_token = $2 WHERE id = $3`, [
            newHash,
            generateToken(24),
            user.id,
          ]);
          // 库中存的是 Token 哈希，保留当前设备的比对需用同样哈希
          await client.query(`DELETE FROM user_devices WHERE user_id = $1 AND device_token <> $2`, [
            user.id,
            hashToken(user.deviceToken),
          ]);
        }
        if (nickname !== undefined || avatarColor !== undefined) {
          await client.query(
            `UPDATE users
           SET nickname = COALESCE($1, nickname),
               avatar_color = COALESCE($2, avatar_color)
           WHERE id = $3`,
            [nickname ?? null, avatarColor ?? null, user.id],
          );
        }
      });
    }

    const updated = await getCurrentUser();
    return NextResponse.json({ user: updated ? toPublicUser(updated) : null });
  },
  { error: '更新个人资料失败' },
);
