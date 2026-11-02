// 分享链接数据查询：/api/shares（管理列表）与 /api/s/[code]（免登录查看）共用
// 统计类查询（总榜/汇总/月度房费/个人明细）统一走 ./statsQueries 共享层，
// 保证与 /api/stats 口径一致；本文件只保留分享特有的取数（分享码、头像、对局分页）
import { query } from '@/lib/db';
import { queryPeriodSummary } from './statsQueries';

export interface ShareRow {
  id: number;
  code: string;
  content_scope: string;
  period_type: 'period' | 'range';
  period: string;
  range_start: string | null;
  range_end: string | null;
  expires_at: string | null;
  created_at: string;
}

/** 分享时间段的中文描述，供管理列表与分享页头部展示 */
export function sharePeriodLabel(
  share: Pick<ShareRow, 'period_type' | 'period' | 'range_start' | 'range_end'>,
): string {
  if (share.period_type === 'range') {
    return `${share.range_start || ''} ~ ${share.range_end || ''}`;
  }
  if (/^\d{4}$/.test(share.period)) {
    return `${share.period}年`;
  }
  if (/^\d{4}-\d{2}$/.test(share.period)) {
    const [year, month] = share.period.split('-');
    return `${year}年${Number(month)}月`;
  }
  return '全部战绩';
}

export async function fetchShareByCode(code: string): Promise<ShareRow | null> {
  const res = await query<ShareRow>(
    `SELECT id, code, content_scope, period_type, period,
            range_start::text AS range_start, range_end::text AS range_end,
            expires_at, created_at
     FROM share_links
     WHERE code = $1
     LIMIT 1`,
    [code],
  );
  return res.rows[0] || null;
}

export interface ShareSummary {
  totalGames: number;
  totalRoomFee: number;
  avgRoomFee: number;
}

/** 指定玩家中已设置自定义头像图片的部分（userId 字符串 → data URL），随分享响应下发供免登录页渲染 */
export async function queryShareAvatars(userIds: number[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  const res = await query<{ id: number; avatar_image: string }>(
    `SELECT id, avatar_image
     FROM users
     WHERE avatar_image IS NOT NULL AND id = ANY($1)`,
    [userIds],
  );
  const avatars: Record<string, string> = {};
  for (const row of res.rows) {
    avatars[String(row.id)] = row.avatar_image;
  }
  return avatars;
}

/** 时间段内的场次与房费汇总（SQL 走共享层，这里只做行 → 响应结构映射） */
export async function queryShareSummary(clause: string, params: unknown[]): Promise<ShareSummary> {
  const res = await queryPeriodSummary(clause, params);
  const totalGames = parseInt(res.rows[0]?.total_games || '0', 10);
  const totalRoomFee = parseInt(res.rows[0]?.total_room_fee || '0', 10);
  return {
    totalGames,
    totalRoomFee,
    avgRoomFee: totalGames > 0 ? Math.round(totalRoomFee / totalGames) : 0,
  };
}

export interface ShareGameRow {
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
}

/** 时间段内的对局分页（CTE + JSON_AGG，口径同 /api/games GET；limit 传「页大小+1」用于判定 hasMore） */
export function queryShareGamesPage(
  clause: string,
  params: unknown[],
  limit: number,
  offset: number,
) {
  const queryParams = [...params, limit, offset];
  return query<ShareGameRow>(
    `WITH page_games AS (
       SELECT g.id, g.played_at, g.room_fee, g.note, g.created_by, g.created_at
       FROM games g
       WHERE 1=1
         ${clause}
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
  );
}

/** 对局行 → 前端响应结构（与 /api/games GET 的映射一致） */
export function mapShareGameRows(rows: ShareGameRow[]) {
  return rows.map((g) => ({
    id: g.id,
    playedAt: g.played_at,
    roomFee: g.room_fee,
    note: g.note || '',
    createdBy: g.created_by,
    creatorNickname: g.creator_nickname,
    createdAt: g.created_at,
    records: g.records,
  }));
}
