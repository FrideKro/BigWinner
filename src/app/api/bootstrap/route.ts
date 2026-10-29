import { NextResponse } from 'next/server';
import { withAuth } from '../_lib/handler';
import { getDefaultRoomFee, listPlayers, toPublicUser } from '../_lib/shared';

// 冷启动聚合接口：一次认证返回用户、玩家列表与默认房费，
// 避免客户端串行请求 auth/me → users + settings。
export const GET = withAuth(
  async (_req, user) => {
    const [players, defaultRoomFee] = await Promise.all([listPlayers(user), getDefaultRoomFee()]);

    return NextResponse.json({
      user: toPublicUser(user),
      players,
      defaultRoomFee,
      deviceToken: user.deviceToken,
    });
  },
  { error: '加载用户信息失败' },
);
