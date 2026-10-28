import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getDefaultRoomFee } from '../_lib/shared';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    return NextResponse.json({ defaultRoomFee: await getDefaultRoomFee() });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json({ error: '获取系统设置失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可修改系统设置' }, { status: 403 });
    }

    const body = await req.json();
    const defaultRoomFee = Number(body.defaultRoomFee);

    if (!Number.isInteger(defaultRoomFee) || defaultRoomFee < 0) {
      return NextResponse.json({ error: '默认每场房费必须为非负整数' }, { status: 400 });
    }
    if (defaultRoomFee > 2147483647) {
      return NextResponse.json(
        { error: '默认每场房费超出系统上限（不超过 2147483647）' },
        { status: 400 },
      );
    }

    await query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('default_room_fee', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(defaultRoomFee)],
    );

    return NextResponse.json({ defaultRoomFee });
  } catch (error) {
    console.error('Update settings error:', error);
    return NextResponse.json({ error: '保存系统设置失败' }, { status: 500 });
  }
}
