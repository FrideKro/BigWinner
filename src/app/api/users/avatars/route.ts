import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withAuth } from '../../_lib/handler';
import { parsePositiveInt } from '../../_lib/params';

const MAX_BATCH_AVATAR_IDS = 50;

// 批量头像取数：替代新设备冷启动时 N 次并发单人头像请求（单次上限 50 个 ID）
export const GET = withAuth(
  async (req) => {
    const rawIds = new URL(req.url).searchParams.get('ids');
    if (!rawIds) {
      return NextResponse.json({ error: '缺少玩家 ID 列表' }, { status: 400 });
    }

    const parts = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      return NextResponse.json({ error: '缺少玩家 ID 列表' }, { status: 400 });
    }
    if (parts.length > MAX_BATCH_AVATAR_IDS) {
      return NextResponse.json(
        { error: `单次最多查询 ${MAX_BATCH_AVATAR_IDS} 位玩家头像` },
        { status: 400 },
      );
    }

    const uniqueIds: number[] = [];
    const seen = new Set<number>();
    for (const part of parts) {
      const id = parsePositiveInt(part);
      if (id === null) {
        return NextResponse.json({ error: '存在无效的玩家 ID' }, { status: 400 });
      }
      if (!seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }

    const res = await query<{
      id: number;
      avatar_image: string | null;
      avatar_version: number;
    }>(
      `SELECT id, avatar_image, avatar_version
       FROM users
       WHERE id = ANY($1)`,
      [uniqueIds],
    );

    const avatars: Record<string, { avatar: string | null; version: number }> = {};
    for (const row of res.rows) {
      avatars[String(row.id)] = {
        avatar: row.avatar_image,
        version: row.avatar_version,
      };
    }

    return NextResponse.json({ avatars });
  },
  { error: '批量获取头像失败' },
);
