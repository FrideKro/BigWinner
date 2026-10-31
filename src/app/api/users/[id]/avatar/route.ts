import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withAuth } from '../../../_lib/handler';

// 单个玩家的自定义头像取数：bootstrap 的 players 只下发 avatar_version（小整数），
// 客户端本地缓存（localStorage）版本一致时零请求，不一致才按需取此接口拉新 data URL。
// 头像本就是全站展示字段，登录用户可见范围与原 players 内联下发一致。
// URL 携带期望版本（?v=）仅用于区分缓存键，服务端不做 304 协商
export const GET = withAuth<{ id: string }>(
  async (_req, _user, { params }) => {
    const { id } = await params;
    const targetId = parseInt(id, 10);
    if (Number.isNaN(targetId) || targetId <= 0) {
      return NextResponse.json({ error: '无效的玩家 ID' }, { status: 400 });
    }

    const res = await query<{ avatar_image: string | null; avatar_version: number }>(
      `SELECT avatar_image, avatar_version FROM users WHERE id = $1`,
      [targetId],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: '玩家不存在' }, { status: 404 });
    }

    return NextResponse.json({
      avatar: res.rows[0].avatar_image,
      version: res.rows[0].avatar_version,
    });
  },
  { error: '获取头像失败' },
);
