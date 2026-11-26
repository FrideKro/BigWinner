import { NextResponse } from 'next/server';
import { setDeviceCookie } from '@/lib/auth';
import { withAuth } from '../_lib/handler';
import { getSystemSettings, listPlayers, toPublicUser } from '../_lib/shared';

// 冷启动聚合接口：一次认证返回用户、玩家列表、默认房费与密码登录开关，
// 避免客户端串行请求 auth/me → users + settings；不再下发明文 deviceToken，并按需顺延 Cookie
export const GET = withAuth(
  async (_req, user) => {
    const [players, settings] = await Promise.all([listPlayers(user), getSystemSettings()]);

    const res = NextResponse.json({
      user: toPublicUser(user),
      players,
      defaultRoomFee: settings.defaultRoomFee,
      passwordLoginEnabled: settings.passwordLoginEnabled,
    });
    if (user.needsExtend) {
      setDeviceCookie(res, user.deviceToken);
    }
    return res;
  },
  { error: '加载用户信息失败' },
);
