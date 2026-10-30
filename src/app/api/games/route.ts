import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import {
  validateAndComputeRecords,
  buildPeriodFilter,
  isValidPeriod,
  validatePlayedAt,
} from '@/lib/gameLogic';
import { validateGameNote } from '@/lib/profileValidation';
import { withAuth, parseJsonBody } from '../_lib/handler';
import { assertRecordsUsersExist } from '../_lib/shared';

export const GET = withAuth(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || 'all';
    if (!isValidPeriod(period)) {
      return NextResponse.json({ error: '时间段参数无效' }, { status: 400 });
    }
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

    const [gamesRes, totalRoomFeeRes] = await Promise.all([
      query<{
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
        `WITH page_games AS (
           SELECT g.id, g.played_at, g.room_fee, g.note, g.created_by, g.created_at
           FROM games g
           WHERE 1=1
             ${clause}
             ${userFilterClause}
           ORDER BY g.played_at DESC, g.id DESC
           LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
         )
         SELECT g.id,
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
         FROM page_games g
         LEFT JOIN users cu ON cu.id = g.created_by
         LEFT JOIN game_records gr ON gr.game_id = g.id
         LEFT JOIN users u ON u.id = gr.user_id
         GROUP BY g.id, g.played_at, g.room_fee, g.note, g.created_by, cu.nickname, g.created_at
         ORDER BY g.played_at DESC, g.id DESC`,
        queryParams,
      ),
      query<{
        total_games: string;
        total_room_fee: string;
      }>(
        `SELECT COUNT(*)::text AS total_games,
                COALESCE(SUM(room_fee), 0)::text AS total_room_fee
         FROM games`,
      ),
    ]);

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
  },
  { error: '获取战绩流水失败' },
);

export const POST = withAuth(
  async (req, user) => {
    const body = await parseJsonBody(req);
    const validation = validateAndComputeRecords(body.records, body.roomFee);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const playedAt = body.playedAt ? new Date(body.playedAt as string) : new Date();
    if (Number.isNaN(playedAt.getTime())) {
      return NextResponse.json({ error: '开局时间格式无效' }, { status: 400 });
    }
    const playedAtError = validatePlayedAt(playedAt);
    if (playedAtError) {
      return NextResponse.json({ error: playedAtError }, { status: 400 });
    }
    const note = String(body.note || '').trim();
    const noteError = validateGameNote(note);
    if (noteError) {
      return NextResponse.json({ error: noteError }, { status: 400 });
    }

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
  },
  { admin: '仅管理员可录入战绩', error: '保存场次战绩失败' },
);
