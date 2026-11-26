import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, withTransaction, generateToken } from '@/lib/db';
import { setDeviceCookie, hashToken } from '@/lib/auth';
import type { UserRole } from '@/lib/roles';
import {
  validatePassword,
  validateProfileLengths,
  validateAvatarImage,
} from '@/lib/profileValidation';
import { clearFailures, getRateLimitState, recordFailure } from '@/lib/rateLimit';
import { withAuth, parseJsonBody } from '../../_lib/handler';
import { toPublicUser, type PublicUser } from '../../_lib/shared';

export const GET = withAuth(
  async (_req, user) => {
    const res = NextResponse.json({
      user: toPublicUser(user),
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
    // 头像图片三态：undefined = 未提供（不动）；null = 清除；string = 设置
    const avatarImage =
      body.avatarImage === undefined
        ? undefined
        : body.avatarImage === null
          ? null
          : String(body.avatarImage);
    const currentPassword = body.currentPassword ? String(body.currentPassword) : undefined;
    const newPassword = body.newPassword ? String(body.newPassword) : undefined;

    if (nickname !== undefined && !nickname) {
      return NextResponse.json({ error: '昵称不能为空' }, { status: 400 });
    }

    const lengthError = validateProfileLengths({ nickname, avatarColor });
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
    const avatarImageError = validateAvatarImage(avatarImage);
    if (avatarImageError) {
      return NextResponse.json({ error: avatarImageError }, { status: 400 });
    }

    let newHash: string | null = null;
    if (newPassword) {
      const passwordError = validatePassword(newPassword, '新密码');
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      const pwRes = await query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.id],
      );
      const storedHash = pwRes.rows[0]?.password_hash || '';
      // 未设密码的账号（临时玩家免密建号）首次设密无需原密码；已有密码则必须校验原密码
      if (storedHash) {
        const pwKey = `pwchange:user:${user.id}`;
        const limitState = getRateLimitState(pwKey);
        if (limitState.locked) {
          const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
          return NextResponse.json(
            { error: `原密码验证失败次数过多，请约 ${minutes} 分钟后再试` },
            { status: 429 },
          );
        }
        if (!currentPassword) {
          return NextResponse.json({ error: '修改密码必须输入当前原密码' }, { status: 400 });
        }
        const match = await bcrypt.compare(currentPassword, storedHash);
        if (!match) {
          recordFailure(pwKey, 5);
          return NextResponse.json({ error: '原密码不正确' }, { status: 400 });
        }
        clearFailures(pwKey);
      }
      newHash = await bcrypt.hash(newPassword, 10);
    }

    let updatedUser: PublicUser = toPublicUser(user);
    if (
      newHash ||
      nickname !== undefined ||
      avatarColor !== undefined ||
      avatarImage !== undefined
    ) {
      // 密码与资料合并为单条 UPDATE ... RETURNING，省去结尾再查一次 getCurrentUser()
      const newBindToken = newHash ? generateToken(24) : null;
      const updatedRow = await withTransaction(async (client) => {
        const res = await client.query<{
          id: number;
          username: string;
          nickname: string;
          role: UserRole;
          avatar_color: string;
          is_active: boolean;
        }>(
          `UPDATE users
           SET password_hash = COALESCE($1, password_hash),
               bind_token = COALESCE($2, bind_token),
               nickname = COALESCE($3, nickname),
               avatar_color = COALESCE($4, avatar_color),
               avatar_image = CASE WHEN $5::boolean THEN $6 ELSE avatar_image END,
               avatar_version = CASE WHEN $5::boolean THEN avatar_version + 1 ELSE avatar_version END
           WHERE id = $7
           RETURNING id, username, nickname, role, avatar_color, is_active`,
          [
            newHash,
            newBindToken,
            nickname ?? null,
            avatarColor ?? null,
            avatarImage !== undefined,
            avatarImage ?? null,
            user.id,
          ],
        );
        if (newHash) {
          // 库中存的是 Token 哈希，保留当前设备的比对需用同样哈希
          await client.query(`DELETE FROM user_devices WHERE user_id = $1 AND device_token <> $2`, [
            user.id,
            hashToken(user.deviceToken),
          ]);
        }
        return res.rows[0];
      });
      if (updatedRow) {
        updatedUser = {
          id: updatedRow.id,
          username: updatedRow.username,
          nickname: updatedRow.nickname,
          role: updatedRow.role,
          avatarColor: updatedRow.avatar_color,
          isActive: updatedRow.is_active,
        };
      }
    }

    return NextResponse.json({ user: updatedUser });
  },
  { error: '更新个人资料失败' },
);
