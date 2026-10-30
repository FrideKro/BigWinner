import { NextResponse } from 'next/server';
import { withAuth } from '../_lib/handler';
import {
  getDefaultRoomFee,
  getPasswordLoginEnabled,
  listPlayers,
  toPublicUser,
} from '../_lib/shared';

// 冷启动聚合接口：一次认证返回用户、玩家列表、默认房费与密码登录开关，
// 避免客户端串行请求 auth/me → users + settings。
export const GET = withAuth(
  async (_req, user) => {
    const [players, defaultRoomFee, passwordLoginEnabled] = await Promise.all([
      listPlayers(user),
      getDefaultRoomFee(),
      getPasswordLoginEnabled(),
    ]);

    return NextResponse.json({
      user: toPublicUser(user),
      players,
      defaultRoomFee,
      passwordLoginEnabled,
      deviceToken: user.deviceToken,
    });
  },
  { error: '加载用户信息失败' },
);
