import { NextRequest, NextResponse } from 'next/server';
import { setDeviceCookie, verifyAndExtendDeviceToken } from '@/lib/auth';
import { clearFailures, getClientIp, getRateLimitState, recordFailure } from '@/lib/rateLimit';
import { ApiError, parseJsonBody } from '../../_lib/handler';

// device_token 实际为 64 位 hex；超长输入按无效凭据处理，防超大字符串进查询与哈希
const MAX_DEVICE_TOKEN_LENGTH = 128;

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    const deviceToken = String(body.deviceToken || '').trim();

    if (!deviceToken) {
      return NextResponse.json({ error: '无有效本地凭证' }, { status: 401 });
    }

    // 限流按 IP 记账；无 x-forwarded-for（直连部署）时跳过计数，
    // 避免所有匿名访客共享同一空桶被集体锁定（同 bind / /api/s/[code] 先例）；
    // device_token 为高熵随机串，枚举不可行，跳过限流的代价可接受
    const clientIp = getClientIp(req.headers);
    const ipKey = clientIp ? `restore:ip:${clientIp}` : null;
    const limitState = ipKey ? getRateLimitState(ipKey) : null;
    if (limitState?.locked) {
      const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `尝试次数过多，请约 ${minutes} 分钟后再试` },
        { status: 429 },
      );
    }

    if (deviceToken.length > MAX_DEVICE_TOKEN_LENGTH) {
      if (ipKey) recordFailure(ipKey, 10);
      return NextResponse.json({ error: '设备凭证已过期' }, { status: 401 });
    }

    const user = await verifyAndExtendDeviceToken(deviceToken);
    if (!user) {
      if (ipKey) recordFailure(ipKey, 10);
      return NextResponse.json({ error: '设备凭证已过期' }, { status: 401 });
    }

    if (ipKey) clearFailures(ipKey);

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
