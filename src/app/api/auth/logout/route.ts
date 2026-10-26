import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { clearDeviceCookie, DEVICE_COOKIE_NAME } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    let token = cookieStore.get(DEVICE_COOKIE_NAME)?.value;

    if (!token) {
      try {
        const body = await req.json();
        token = body?.deviceToken;
      } catch {
        /* empty body */
      }
    }

    if (token) {
      await query(`DELETE FROM user_devices WHERE device_token = $1`, [token]);
    }

    const res = NextResponse.json({ ok: true });
    clearDeviceCookie(res);
    return res;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: '退出失败' }, { status: 500 });
  }
}
