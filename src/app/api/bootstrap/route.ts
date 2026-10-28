import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDefaultRoomFee, listPlayers, toPublicUser } from '../_lib/shared';

// 冷启动聚合接口：一次认证返回用户、玩家列表与默认房费，
// 避免客户端串行请求 auth/me → users + settings。
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const [players, defaultRoomFee] = await Promise.all([listPlayers(user), getDefaultRoomFee()]);

    return NextResponse.json({
      user: toPublicUser(user),
      players,
      defaultRoomFee,
      deviceToken: user.deviceToken,
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    return NextResponse.json({ error: '加载用户信息失败' }, { status: 500 });
  }
}
