import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { validateAndComputeRecords } from '@/lib/gameLogic';

// 校验本场全部玩家存在，避免命中外键约束后返回不友好的 500
async function assertRecordsUsersExist(client: PoolClient, userIds: number[]): Promise<void> {
  const found = await client.query<{ id: number }>(`SELECT id FROM users WHERE id = ANY($1)`, [
    userIds,
  ]);
  if ((found.rowCount ?? 0) !== userIds.length) {
    throw new Error('INVALID_PLAYERS');
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可修改战绩' }, { status: 403 });
    }

    const { id } = await context.params;
    const gameId = parseInt(id, 10);
    if (Number.isNaN(gameId)) {
      return NextResponse.json({ error: '无效的场次 ID' }, { status: 400 });
    }

    const body = await req.json();
    const validation = validateAndComputeRecords(body.records, body.roomFee);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const playedAt = body.playedAt ? new Date(body.playedAt) : new Date();
    if (Number.isNaN(playedAt.getTime())) {
      return NextResponse.json({ error: '开局时间格式无效' }, { status: 400 });
    }
    const note = String(body.note || '').trim();

    await withTransaction(async (client) => {
      const updateRes = await client.query(
        `UPDATE games
         SET played_at = $1,
             room_fee = $2,
             note = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [playedAt.toISOString(), validation.roomFee, note, gameId],
      );

      if (updateRes.rowCount === 0) {
        throw new Error('NOT_FOUND');
      }

      await assertRecordsUsersExist(
        client,
        validation.records.map((r) => r.userId),
      );

      await client.query(`DELETE FROM game_records WHERE game_id = $1`, [gameId]);

      for (const rec of validation.records) {
        await client.query(
          `INSERT INTO game_records (game_id, user_id, amount, is_big_winner)
           VALUES ($1, $2, $3, $4)`,
          [gameId, rec.userId, rec.amount, rec.isBigWinner],
        );
      }
    });

    return NextResponse.json({ id: gameId, ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: '场次记录不存在' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'INVALID_PLAYERS') {
      return NextResponse.json({ error: '包含无效的玩家，请刷新玩家列表后重试' }, { status: 400 });
    }
    console.error('Update game error:', error);
    return NextResponse.json({ error: '修改场次战绩失败' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可删除战绩' }, { status: 403 });
    }

    const { id } = await context.params;
    const gameId = parseInt(id, 10);
    if (Number.isNaN(gameId)) {
      return NextResponse.json({ error: '无效的场次 ID' }, { status: 400 });
    }

    const delRes = await query(`DELETE FROM games WHERE id = $1`, [gameId]);
    if (delRes.rowCount === 0) {
      return NextResponse.json({ error: '场次记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete game error:', error);
    return NextResponse.json({ error: '删除场次战绩失败' }, { status: 500 });
  }
}
