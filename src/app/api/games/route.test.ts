// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    fn({ query: mocks.query }),
}));

import { GET, POST } from './route';

const adminUser = {
  id: 1,
  username: 'admin',
  nickname: '管理员',
  role: 'ADMIN' as const,
  avatarColor: 'amber',
  isActive: true,
  bindToken: 'bind-token',
  deviceToken: 't'.repeat(64),
};

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPost(body: unknown) {
  return POST(postReq(body), { params: Promise.resolve({}) });
}

function callGet(query = '') {
  const req = new NextRequest(`http://localhost/api/games${query}`);
  return GET(req, { params: Promise.resolve({}) });
}

// 合法配平的一局：玩家 1 赢 100，玩家 2 输 140，房费 40
const balancedBody = {
  playedAt: '2026-10-30T14:00:00+08:00',
  roomFee: 40,
  note: '测试局',
  records: [
    { userId: 1, amount: 100 },
    { userId: 2, amount: -140 },
  ],
};

describe('POST /api/games', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非管理员不能录入战绩', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await callPost(balancedBody);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '仅管理员可录入战绩' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('账目未配平返回 400，不触库', async () => {
    const res = await callPost({ ...balancedBody, roomFee: 41 });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('账目未配平');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('金额非整数返回 400', async () => {
    const res = await callPost({
      ...balancedBody,
      records: [
        { userId: 1, amount: 100.5 },
        { userId: 2, amount: -140.5 },
      ],
    });

    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('开局时间超出合理范围返回 400', async () => {
    const res = await callPost({ ...balancedBody, playedAt: '1899-01-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '开局时间超出合理范围（2000 ~ 2100 年）' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('配平通过：事务内校验玩家并批量写入，大赢家标记正确', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/FROM users WHERE id = ANY/.test(sql)) {
        return Promise.resolve({
          rows: [
            { id: 1, is_active: true },
            { id: 2, is_active: true },
          ],
          rowCount: 2,
        });
      }
      if (/INSERT INTO games/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (/INSERT INTO game_records/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 2 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });

    const res = await callPost(balancedBody);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 42 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO game_records'), [
      42,
      [1, 2],
      [100, -140],
      [true, false],
    ]);
  });

  it('包含停用玩家返回 400', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/FROM users WHERE id = ANY/.test(sql)) {
        return Promise.resolve({
          rows: [
            { id: 1, is_active: true },
            { id: 2, is_active: false },
          ],
          rowCount: 2,
        });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });

    const res = await callPost(balancedBody);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '包含不可用的玩家，请刷新玩家列表后重试' });
  });
});

describe('GET /api/games', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非法 period 参数返回 400（不静默退化为全部数据）', async () => {
    const res = await callGet('?period=abc');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '时间段参数无效' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('合法 period 返回分页流水与全量汇总', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/page_games/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/total_room_fee/.test(sql)) {
        return Promise.resolve({
          rows: [{ total_games: '3', total_room_fee: '300' }],
          rowCount: 1,
        });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });

    const res = await callGet('?period=2025-10&limit=50&offset=0');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.games).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.allTimeTotalGames).toBe(3);
    expect(body.allTimeTotalRoomFee).toBe(300);
  });
});
