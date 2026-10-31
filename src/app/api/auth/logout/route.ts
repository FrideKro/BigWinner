import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { clearDeviceCookie, DEVICE_COOKIE_NAME, hashToken } from '@/lib/auth';
import { ApiError, parseJsonBody } from '../../_lib/handler';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    let token = cookieStore.get(DEVICE_COOKIE_NAME)?.value;

    if (!token) {
      try {
        const body = await parseJsonBody(req);
        const bodyToken = String(body.deviceToken || '').trim();
        if (bodyToken) token = bodyToken;
      } catch (error) {
        // 登出保持宽容：body 缺失/非法时仅清 Cookie；仅超大 body 拒绝
        if (error instanceof ApiError && error.status === 413) {
          return NextResponse.json({ error: error.message }, { status: 413 });
        }
        /* empty body */
      }
    }

    if (token) {
      // 库中存的是 Token 哈希，删除前先做同样哈希
      await query(`DELETE FROM user_devices WHERE device_token = $1`, [hashToken(token)]);
    }

    const res = NextResponse.json({ ok: true });
    clearDeviceCookie(res);
    return res;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: '退出失败' }, { status: 500 });
  }
}
