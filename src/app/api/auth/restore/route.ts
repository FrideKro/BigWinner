import { NextRequest, NextResponse } from 'next/server';
import { setDeviceCookie, verifyAndExtendDeviceToken } from '@/lib/auth';
import { clearFailures, getClientIp, getRateLimitState, recordFailure } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deviceToken = String(body.deviceToken || '').trim();

    if (!deviceToken) {
      return NextResponse.json({ error: '无有效本地凭证' }, { status: 401 });
    }

    const ipKey = `restore:ip:${getClientIp(req.headers)}`;
    const limitState = getRateLimitState(ipKey);
    if (limitState.locked) {
      const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `尝试次数过多，请约 ${minutes} 分钟后再试` },
        { status: 429 },
      );
    }

    const user = await verifyAndExtendDeviceToken(deviceToken);
    if (!user) {
      recordFailure(ipKey, 10);
      return NextResponse.json({ error: '设备凭证已过期' }, { status: 401 });
    }

    clearFailures(ipKey);

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatarColor,
        isActive: user.isActive,
      },
      deviceToken: user.deviceToken,
    });

    setDeviceCookie(res, user.deviceToken);
    return res;
  } catch (error) {
    console.error('Restore session error:', error);
    return NextResponse.json({ error: '恢复会话失败' }, { status: 500 });
  }
}
