import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { validateAndComputeRecords } from '@/lib/gameLogic';
import { withAuth, parseJsonBody, ApiError } from '../../_lib/handler';
import { assertRecordsUsersExist } from '../../_lib/shared';

export const PUT = withAuth<{ id: string }>(
  async (req, _user, { params }) => {
    const { id } = await params;
    const gameId = parseInt(id, 10);
    if (Number.isNaN(gameId)) {
      return NextResponse.json({ error: '无效的场次 ID' }, { status: 400 });
    }

    const body = await parseJsonBody(req);
    const validation = validateAndComputeRecords(body.records, body.roomFee);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const playedAt = body.playedAt ? new Date(body.playedAt as string) : new Date();
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
        throw new ApiError(404, '场次记录不存在');
      }

      await assertRecordsUsersExist(
        client,
        validation.records.map((r) => r.userId),
      );

      await client.query(`DELETE FROM game_records WHERE game_id = $1`, [gameId]);

      // 单条语句批量写入，避免事务内逐条往返
      await client.query(
        `INSERT INTO game_records (game_id, user_id, amount, is_big_winner)
         SELECT $1, x.user_id, x.amount, x.is_big_winner
         FROM UNNEST($2::int[], $3::int[], $4::bool[]) AS x(user_id, amount, is_big_winner)`,
        [
          gameId,
          validation.records.map((r) => r.userId),
          validation.records.map((r) => r.amount),
          validation.records.map((r) => r.isBigWinner),
        ],
      );
    });

    return NextResponse.json({ id: gameId, ok: true });
  },
  { admin: '仅管理员可修改战绩', error: '修改场次战绩失败' },
);

export const DELETE = withAuth<{ id: string }>(
  async (_req, _user, { params }) => {
    const { id } = await params;
    const gameId = parseInt(id, 10);
    if (Number.isNaN(gameId)) {
      return NextResponse.json({ error: '无效的场次 ID' }, { status: 400 });
    }

    const delRes = await query(`DELETE FROM games WHERE id = $1`, [gameId]);
    if (delRes.rowCount === 0) {
      return NextResponse.json({ error: '场次记录不存在' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  },
  { admin: '仅管理员可删除战绩', error: '删除场次战绩失败' },
);
