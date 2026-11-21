import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withTransaction, generateToken } from '@/lib/db';
import { generateRandomPassword, hashToken } from '@/lib/auth';
import {
  validatePassword,
  validateProfileLengths,
  validateAvatarImage,
} from '@/lib/profileValidation';
import { parseUserRole, type UserRole } from '@/lib/roles';
import { withAuth, parseJsonBody, ApiError } from '../../_lib/handler';
import { parsePositiveInt } from '../../_lib/params';

export const PATCH = withAuth<{ id: string }>(
  async (req, user, { params }) => {
    const { id } = await params;
    const targetId = parsePositiveInt(id);
    if (targetId === null) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    const body = await parseJsonBody(req);

    const nickname = body.nickname !== undefined ? String(body.nickname).trim() : undefined;
    const username = body.username !== undefined ? String(body.username).trim() : undefined;
    // 角色三选一：ADMIN / PLAYER / TEMP_PLAYER，非法值一律 400（不静默回落 PLAYER）
    let role: UserRole | undefined;
    if (body.role !== undefined) {
      const parsedRole = parseUserRole(body.role);
      if (!parsedRole) {
        return NextResponse.json({ error: 'role 参数无效' }, { status: 400 });
      }
      role = parsedRole;
    }
    const avatarColor =
      body.avatarColor !== undefined ? String(body.avatarColor).trim() : undefined;
    // 头像图片三态：undefined = 未提供（不动）；null = 清除；string = 设置（管理员可代设/清除不当图片）
    const avatarImage =
      body.avatarImage === undefined
        ? undefined
        : body.avatarImage === null
          ? null
          : String(body.avatarImage);
    // isActive 仅接受布尔：Boolean("false") === true 的强转会让停用静默变成启用
    let isActive: boolean | undefined;
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive 参数无效' }, { status: 400 });
      }
      isActive = body.isActive;
    }
    const newPassword = body.password ? String(body.password) : undefined;
    // 重置密码：服务端生成随机密码并在响应中一次性返回，避免弱默认密码（如 123456）
    let resetPassword = false;
    if (body.resetPassword !== undefined) {
      if (typeof body.resetPassword !== 'boolean') {
        return NextResponse.json({ error: 'resetPassword 参数无效' }, { status: 400 });
      }
      resetPassword = body.resetPassword;
    }
    const resetPasswordValue = resetPassword ? generateRandomPassword() : undefined;
    const passwordToSet = resetPasswordValue ?? newPassword;
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
    const avatarImageError = validateAvatarImage(avatarImage);
    if (avatarImageError) {
      return NextResponse.json({ error: avatarImageError }, { status: 400 });
    }
    if (passwordToSet !== undefined) {
      const passwordError = validatePassword(passwordToSet);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
    }

    const passwordHash = passwordToSet !== undefined ? await bcrypt.hash(passwordToSet, 10) : null;
    // 重置密码时同步轮换专属绑定链接，确保已外泄的免登链接一并失效
    const newBindToken = regenerateBindToken || Boolean(passwordHash) ? generateToken(24) : null;

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

      // 降级为任意非管理员角色（普通玩家或临时玩家）或停用，都需要先数清剩余管理员
      const demotingAdmin = role !== undefined && role !== 'ADMIN';
      if (demotingAdmin || isActive === false) {
        // 先锁定现有管理员行再计数：并发降级/停用请求在此串行化，
        // 后到者能看到先到者已提交的结果，防止把仅有的两名管理员同时降级/停用
        await client.query(`SELECT id FROM users WHERE role = 'ADMIN' FOR UPDATE`);

        if (demotingAdmin) {
          const adminCountRes = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND id != $1`,
            [targetId],
          );
          const remainingAdmins = parseInt(adminCountRes.rows[0]?.count || '0', 10);
          if (remainingAdmins === 0) {
            throw new ApiError(400, '系统中必须保留至少一位管理员，无法降级');
          }
        }

        // 停用与降级同等级守卫：登录与设备校验全链路拒绝停用账号，
        // 停用唯一「启用中」的管理员会让管理入口全灭（玩家密码登录默认关闭，无自恢复入口）
        if (isActive === false) {
          const activeAdminRes = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM users WHERE role = 'ADMIN' AND is_active = TRUE AND id != $1`,
            [targetId],
          );
          const remainingActiveAdmins = parseInt(activeAdminRes.rows[0]?.count || '0', 10);
          if (remainingActiveAdmins === 0) {
            throw new ApiError(400, '必须保留至少一位启用中的管理员，无法停用');
          }
        }
      }

      // 重置专属绑定链接（可选）
      if (newBindToken) {
        await client.query(`UPDATE users SET bind_token = $1 WHERE id = $2`, [
          newBindToken,
          targetId,
        ]);
      }
      // 清除已绑定设备（可选）：可独立于轮换链接单独传入，立即下线目标玩家全部设备
      if (revokeDevices) {
        await client.query(`DELETE FROM user_devices WHERE user_id = $1`, [targetId]);
      }

      // 重置密码后下线该用户设备，确保旧登录凭据立即失效；
      // 管理员重置自己的密码时保留当前设备避免自登出（与 me PATCH 行为一致），重置他人则全下线
      if (passwordHash) {
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
          passwordHash,
          targetId,
        ]);
        if (targetId === user.id) {
          await client.query(`DELETE FROM user_devices WHERE user_id = $1 AND device_token <> $2`, [
            targetId,
            hashToken(user.deviceToken),
          ]);
        } else {
          await client.query(`DELETE FROM user_devices WHERE user_id = $1`, [targetId]);
        }
      }

      // 头像图片需支持置 NULL 清除，不能并入下方 COALESCE 部分更新；同语句递增版本号供客户端本地缓存失效判断
      if (avatarImage !== undefined) {
        await client.query(
          `UPDATE users SET avatar_image = $1, avatar_version = avatar_version + 1 WHERE id = $2`,
          [avatarImage, targetId],
        );
      }

      const updatedRes = await client.query<{
        id: number;
        username: string;
        nickname: string;
        role: UserRole;
        avatar_color: string;
        avatar_version: number;
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
         RETURNING id, username, nickname, role, avatar_color, avatar_version, is_active, bind_token, created_at`,
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
    }).catch((error: unknown) => {
      // 应用层查重与更新之间的并发窗口由 LOWER(username) 唯一索引兜底，转换为友好 409
      if ((error as { code?: string }).code === '23505') {
        throw new ApiError(409, `登录账号 "${username ?? ''}" 已被占用`);
      }
      throw error;
    });

    return NextResponse.json({
      user: {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        role: u.role,
        avatarColor: u.avatar_color,
        avatarVersion: u.avatar_version,
        isActive: u.is_active,
        bindToken: u.bind_token,
        createdAt: u.created_at,
      },
      // 随机密码仅在此响应中出现一次，管理端需立即复制转告
      ...(resetPasswordValue ? { newPassword: resetPasswordValue } : {}),
    });
  },
  { admin: '仅管理员可修改玩家账号', error: '更新玩家信息失败' },
);
