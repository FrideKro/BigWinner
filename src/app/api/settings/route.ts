import { NextResponse } from 'next/server';
import { withTransaction } from '@/lib/db';
import { withAuth, parseJsonBody } from '../_lib/handler';
import { getDefaultRoomFee, getPasswordLoginEnabled } from '../_lib/shared';

export const GET = withAuth(
  async () => {
    const [defaultRoomFee, passwordLoginEnabled] = await Promise.all([
      getDefaultRoomFee(),
      getPasswordLoginEnabled(),
    ]);
    return NextResponse.json({ defaultRoomFee, passwordLoginEnabled });
  },
  { error: '获取系统设置失败' },
);

export const PUT = withAuth(
  async (req) => {
    const body = await parseJsonBody(req);
    const hasRoomFee = body.defaultRoomFee !== undefined;
    const hasPasswordLogin = body.passwordLoginEnabled !== undefined;

    if (!hasRoomFee && !hasPasswordLogin) {
      return NextResponse.json({ error: '没有需要保存的设置' }, { status: 400 });
    }

    let defaultRoomFee: number | undefined;
    if (hasRoomFee) {
      defaultRoomFee = Number(body.defaultRoomFee);
      if (!Number.isInteger(defaultRoomFee) || defaultRoomFee < 0) {
        return NextResponse.json({ error: '默认每场房费必须为非负整数' }, { status: 400 });
      }
      if (defaultRoomFee > 2147483647) {
        return NextResponse.json(
          { error: '默认每场房费超出系统上限（不超过 2147483647）' },
          { status: 400 },
        );
      }
    }

    let passwordLoginEnabled: boolean | undefined;
    if (hasPasswordLogin) {
      if (typeof body.passwordLoginEnabled !== 'boolean') {
        return NextResponse.json({ error: '密码登录开关必须为布尔值' }, { status: 400 });
      }
      passwordLoginEnabled = body.passwordLoginEnabled;
    }

    await withTransaction(async (client) => {
      if (defaultRoomFee !== undefined) {
        await client.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('default_room_fee', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [String(defaultRoomFee)],
        );
      }
      if (passwordLoginEnabled !== undefined) {
        await client.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('password_login_enabled', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [String(passwordLoginEnabled)],
        );
      }
    });

    return NextResponse.json({
      defaultRoomFee: defaultRoomFee ?? (await getDefaultRoomFee()),
      passwordLoginEnabled: passwordLoginEnabled ?? (await getPasswordLoginEnabled()),
    });
  },
  { admin: '仅管理员可修改系统设置', error: '保存系统设置失败' },
);
