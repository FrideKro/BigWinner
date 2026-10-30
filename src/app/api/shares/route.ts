import { NextResponse } from 'next/server';
import { generateToken, query, withTransaction } from '@/lib/db';
import {
  shareExpiryInstant,
  validateShareExpiresOn,
  validateSharePeriodInput,
  validateShareScope,
} from '@/lib/shareValidation';
import { withAuth, parseJsonBody } from '../_lib/handler';
import { sharePeriodLabel, type ShareRow } from '../_lib/shareData';

// 分享码：generateToken(8) → 16 位 hex，碰撞概率极低；插入冲突时换码重试
const CODE_ATTEMPTS = 3;
const SHARE_LIST_LIMIT = 20;

// 创建分享链接（仅管理员）：内容模块 + 时间段（周期/自定义区间）+ 预设有效期
export const POST = withAuth(
  async (req, user) => {
    const body = await parseJsonBody(req);
    const scopeRes = validateShareScope(body.contentScope);
    if (scopeRes.error) {
      return NextResponse.json({ error: scopeRes.error }, { status: 400 });
    }
    const periodRes = validateSharePeriodInput({
      periodType: body.periodType,
      period: body.period,
      rangeStart: body.rangeStart,
      rangeEnd: body.rangeEnd,
    });
    if (periodRes.error) {
      return NextResponse.json({ error: periodRes.error }, { status: 400 });
    }
    // 有效期：'YYYY-MM-DD' 自然日（含当天，至当天 24:00）或 null（永久）
    const expiresRes = validateShareExpiresOn(body.expiresOn);
    if (expiresRes.error) {
      return NextResponse.json({ error: expiresRes.error }, { status: 400 });
    }
    const expiresAt =
      expiresRes.expiresOn === null ? null : shareExpiryInstant(expiresRes.expiresOn);
    const contentScope = scopeRes.scope.join(',');
    const rangeStart = periodRes.periodType === 'range' ? periodRes.rangeStart : null;
    const rangeEnd = periodRes.periodType === 'range' ? periodRes.rangeEnd : null;

    // 唯一冲突（概率极低）时换码重试；每次尝试独立事务，失败后事务不可复用
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      try {
        const created = await withTransaction(async (client) => {
          const code = generateToken(8);
          const insertRes = await client.query<{ id: number; code: string }>(
            `INSERT INTO share_links (code, content_scope, period_type, period, range_start, range_end, created_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, code`,
            [
              code,
              contentScope,
              periodRes.periodType,
              periodRes.period,
              rangeStart,
              rangeEnd,
              user.id,
              expiresAt,
            ],
          );
          return insertRes.rows[0];
        });
        return NextResponse.json({ id: created.id, code: created.code }, { status: 201 });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') {
          continue;
        }
        throw err;
      }
    }
    // 走到这里说明连续多次分享码唯一冲突（概率极低），统一文案兜底
    return NextResponse.json({ error: '创建分享链接失败，请重试' }, { status: 500 });
  },
  { admin: '仅管理员可创建分享链接', error: '创建分享链接失败' },
);

// 最近创建的分享列表（仅管理员），供分享弹窗内管理与复制
export const GET = withAuth(
  async () => {
    const res = await query<ShareRow>(
      `SELECT id, code, content_scope, period_type, period,
              range_start::text AS range_start, range_end::text AS range_end,
              expires_at, created_at
       FROM share_links
       ORDER BY created_at DESC, id DESC
       LIMIT ${SHARE_LIST_LIMIT}`,
    );
    const shares = res.rows.map((row) => ({
      id: row.id,
      code: row.code,
      contentScope: row.content_scope.split(','),
      periodType: row.period_type,
      period: row.period,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      periodLabel: sharePeriodLabel(row),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
    return NextResponse.json({ shares });
  },
  { admin: '仅管理员可查看分享链接', error: '获取分享列表失败' },
);
