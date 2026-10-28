import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { validateAndComputeRecords, buildPeriodFilter } from '@/lib/gameLogic';

// 校验本场全部玩家存在，避免命中外键约束后返回不友好的 500
async function assertRecordsUsersExist(client: PoolClient, userIds: number[]): Promise<void> {
  const found = await client.query<{ id: number }>(`SELECT id FROM users WHERE id = ANY($1)`, [
    userIds,
  ]);
  if ((found.rowCount ?? 0) !== userIds.length) {
    throw new Error('INVALID_PLAYERS');
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'all';
    const userIdFilter = searchParams.get('userId')
      ? parseInt(searchParams.get('userId')!, 10)
      : null;

    const rawLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const { clause, params } = buildPeriodFilter(period, 1);
    const queryParams: unknown[] = [...params];
    let userFilterClause = '';

    if (userIdFilter && !Number.isNaN(userIdFilter)) {
      queryParams.push(userIdFilter);
      userFilterClause = `AND EXISTS (
        SELECT 1 FROM game_records gr_sub
        WHERE gr_sub.game_id = g.id AND gr_sub.user_id = $${queryParams.length}
      )`;
    }

    queryParams.push(limit + 1, offset);

    const gamesRes = await query<{
      id: number;
      played_at: string;
      room_fee: number;
      note: string;
      created_by: number | null;
      creator_nickname: string | null;
      created_at: string;
      records: Array<{
        userId: number;
        nickname: string;
        avatarColor: string;
        amount: number;
        isBigWinner: boolean;
      }>;
    }>(
      `SELECT g.id,
              g.played_at,
              g.room_fee,
              g.note,
              g.created_by,
              cu.nickname AS creator_nickname,
              g.created_at,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'userId', gr.user_id,
                    'nickname', u.nickname,
                    'avatarColor', u.avatar_color,
                    'amount', gr.amount,
                    'isBigWinner', gr.is_big_winner
                  ) ORDER BY gr.amount DESC, gr.id ASC
                ) FILTER (WHERE gr.id IS NOT NULL),
                '[]'::json
              ) AS records
       FROM games g
       LEFT JOIN users cu ON cu.id = g.created_by
       LEFT JOIN game_records gr ON gr.game_id = g.id
       LEFT JOIN users u ON u.id = gr.user_id
       WHERE 1=1
         ${clause}
         ${userFilterClause}
       GROUP BY g.id, cu.nickname
       ORDER BY g.played_at DESC, g.id DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams,
    );

    const totalRoomFeeRes = await query<{
      total_games: string;
      total_room_fee: string;
    }>(
      `SELECT COUNT(*)::text AS total_games,
              COALESCE(SUM(room_fee), 0)::text AS total_room_fee
       FROM games`,
    );

    // 多取一条用于判断是否还有下一页
    const hasMore = gamesRes.rows.length > limit;
    const pageRows = hasMore ? gamesRes.rows.slice(0, limit) : gamesRes.rows;

    return NextResponse.json({
      games: pageRows.map((g) => ({
        id: g.id,
        playedAt: g.played_at,
        roomFee: g.room_fee,
        note: g.note || '',
        createdBy: g.created_by,
        creatorNickname: g.creator_nickname,
        createdAt: g.created_at,
        records: g.records,
      })),
      hasMore,
      allTimeTotalGames: parseInt(totalRoomFeeRes.rows[0]?.total_games || '0', 10),
      allTimeTotalRoomFee: parseInt(totalRoomFeeRes.rows[0]?.total_room_fee || '0', 10),
    });
  } catch (error) {
    console.error('Get games error:', error);
    return NextResponse.json({ error: '获取战绩流水失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可录入战绩' }, { status: 403 });
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

    const createdGameId = await withTransaction(async (client) => {
      await assertRecordsUsersExist(
        client,
        validation.records.map((r) => r.userId),
      );

      const gameInsert = await client.query<{ id: number }>(
        `INSERT INTO games (played_at, room_fee, note, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [playedAt.toISOString(), validation.roomFee, note, user.id],
      );
      const gameId = gameInsert.rows[0].id;

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

      return gameId;
    });

    return NextResponse.json({ id: createdGameId }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PLAYERS') {
      return NextResponse.json({ error: '包含无效的玩家，请刷新玩家列表后重试' }, { status: 400 });
    }
    console.error('Create game error:', error);
    return NextResponse.json({ error: '保存场次战绩失败' }, { status: 500 });
  }
}
