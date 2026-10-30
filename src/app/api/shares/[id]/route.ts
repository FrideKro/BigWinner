import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withAuth } from '../../_lib/handler';

// 删除分享链接（仅管理员）：行删除即时失效，访客再打开即 404
export const DELETE = withAuth<{ id: string }>(
  async (_req, _user, { params }) => {
    const { id } = await params;
    const shareId = parseInt(id, 10);
    if (Number.isNaN(shareId) || shareId <= 0) {
      return NextResponse.json({ error: '无效的分享 ID' }, { status: 400 });
    }

    const delRes = await query(`DELETE FROM share_links WHERE id = $1`, [shareId]);
    if (delRes.rowCount === 0) {
      return NextResponse.json({ error: '分享不存在或已被删除' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  },
  { admin: '仅管理员可删除分享链接', error: '删除分享链接失败' },
);
