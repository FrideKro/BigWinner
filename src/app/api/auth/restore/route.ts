import { NextRequest, NextResponse } from 'next/server';
import { setDeviceCookie, verifyAndExtendDeviceToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deviceToken = String(body.deviceToken || '').trim();

    if (!deviceToken) {
      return NextResponse.json({ error: '无有效本地凭证' }, { status: 401 });
    }

    const user = await verifyAndExtendDeviceToken(deviceToken);
    if (!user) {
      return NextResponse.json({ error: '设备凭证已过期' }, { status: 401 });
    }

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatarColor,
        isActive: user.isActive,
        bindToken: user.bindToken,
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
