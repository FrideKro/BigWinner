// 统计口径共享查询层：/api/stats（登录态）与分享链路（/api/s/[code]）共用同一份 SQL，
// 保证免登录访客与登录用户看到的榜单/汇总数字完全一致，避免双份维护漂移。
// 时间过滤 clause 由 buildPeriodFilter / buildDateRangeFilter 生成（表别名固定为 g），
// 传空串表示不过滤（全量口径）。
import { query } from '@/lib/db';
import type { LeaderboardSqlRow, PersonalHistorySqlRow } from './statsAgg';

/** 时间段内总榜；rank 由 mapLeaderboardRows 按返回行序生成（与 SQL ORDER BY 一一对应） */
export function queryLeaderboard(clause: string, params: unknown[]) {
  return query<LeaderboardSqlRow>(
    `SELECT u.id AS user_id,
            u.nickname,
            u.avatar_color,
            u.is_active,
            COUNT(gr.id)::text AS games_played,
            COALESCE(SUM(gr.amount), 0)::text AS net_amount,
            COUNT(gr.id) FILTER (WHERE gr.amount > 0)::text AS win_count,
            COUNT(gr.id) FILTER (WHERE gr.amount = 0)::text AS draw_count,
            COUNT(gr.id) FILTER (WHERE gr.amount < 0)::text AS loss_count,
            COUNT(gr.id) FILTER (WHERE gr.is_big_winner = TRUE)::text AS big_winner_count,
            COALESCE(MAX(gr.amount) FILTER (WHERE gr.amount > 0), 0)::text AS max_win,
            COALESCE(MIN(gr.amount) FILTER (WHERE gr.amount < 0), 0)::text AS max_loss
     FROM users u
     LEFT JOIN (
       SELECT gr_inner.*
       FROM game_records gr_inner
       JOIN games g ON g.id = gr_inner.game_id
       WHERE 1=1 ${clause}
     ) gr ON gr.user_id = u.id
     WHERE u.is_active = TRUE OR gr.id IS NOT NULL
     GROUP BY u.id
     ORDER BY (COUNT(gr.id) > 0) DESC,
              COALESCE(SUM(gr.amount), 0) DESC,
              COUNT(gr.id) FILTER (WHERE gr.is_big_winner = TRUE) DESC,
              COUNT(gr.id) DESC,
              u.id ASC`,
    params,
  );
}

/** 时间段内场次与房费汇总 */
export function queryPeriodSummary(clause: string, params: unknown[]) {
  return query<{ total_games: string; total_room_fee: string }>(
    `SELECT COUNT(*)::text AS total_games,
            COALESCE(SUM(g.room_fee), 0)::text AS total_room_fee
     FROM games g
     WHERE 1=1 ${clause}`,
    params,
  );
}

/** 按月聚合的房费明细。limit 可选：/api/stats 传 36 封顶近期月份，分享链路按分享
 *  时间段过滤（最长 366 天）天然有界不设限；LIMIT 走占位符防拼接 */
export function queryMonthlyFees(clause: string, params: unknown[], limit?: number) {
  const sql = `SELECT TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM') AS month,
            COUNT(*)::text AS games_count,
            COALESCE(SUM(g.room_fee), 0)::text AS total_room_fee
     FROM games g
     WHERE 1=1 ${clause}
     GROUP BY 1
     ORDER BY 1 DESC`;
  if (limit !== undefined) {
    return query<{ month: string; games_count: string; total_room_fee: string }>(
      `${sql} LIMIT $${params.length + 1}`,
      [...params, limit],
    );
  }
  return query<{ month: string; games_count: string; total_room_fee: string }>(sql, params);
}

/** 指定玩家在时间段内的场次明细；固定 ORDER BY played_at ASC，供 buildPersonalTrend 按行序计算 */
export function queryPersonalHistory(clause: string, params: unknown[], userId: number) {
  const queryParams = [...params, userId];
  return query<PersonalHistorySqlRow>(
    `SELECT g.id AS game_id,
            g.played_at,
            TO_CHAR(g.played_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD') AS date_label,
            gr.amount,
            gr.is_big_winner,
            g.room_fee,
            g.note
     FROM game_records gr
     JOIN games g ON g.id = gr.game_id
     WHERE gr.user_id = $${queryParams.length}
       ${clause}
     ORDER BY g.played_at ASC, g.id ASC`,
    queryParams,
  );
}
