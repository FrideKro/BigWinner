import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withAuth } from '../../../_lib/handler';
import { parseNonNegativeInt, parsePositiveInt } from '../../../_lib/params';

// 单个玩家的自定义头像取数：bootstrap 的 players 只下发 avatar_version（小整数），
// 客户端本地缓存（localStorage）版本一致时零请求，不一致才按需取此接口拉新 data URL。
// URL 携带期望版本（?v=）且与库中 avatar_version 一致时可安全走长效私有不可变缓存
export const GET = withAuth<{ id: string }>(
  async (req, _user, { params }) => {
    const { id } = await params;
    const targetId = parsePositiveInt(id);
    if (targetId === null) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    const res = await query<{ avatar_image: string | null; avatar_version: number }>(
      `SELECT avatar_image, avatar_version FROM users WHERE id = $1`,
      [targetId],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: '玩家不存在' }, { status: 404 });
    }

    const row = res.rows[0];
    const requestedVersion = parseNonNegativeInt(new URL(req.url).searchParams.get('v'));
    const headers: Record<string, string> = {};
    if (requestedVersion !== null && requestedVersion === row.avatar_version) {
      headers['Cache-Control'] = 'private, max-age=31536000, immutable';
    }

    return NextResponse.json(
      {
        avatar: row.avatar_image,
        version: row.avatar_version,
      },
      { headers },
    );
  },
  { error: '获取头像失败' },
);
