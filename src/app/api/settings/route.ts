import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withAuth, parseJsonBody } from '../_lib/handler';
import { getDefaultRoomFee } from '../_lib/shared';

export const GET = withAuth(
  async () => NextResponse.json({ defaultRoomFee: await getDefaultRoomFee() }),
  { error: '获取系统设置失败' },
);

export const PUT = withAuth(
  async (req) => {
    const body = await parseJsonBody(req);
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
  },
  { admin: '仅管理员可修改系统设置', error: '保存系统设置失败' },
);
