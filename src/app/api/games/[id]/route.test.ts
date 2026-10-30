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

import { DELETE, PUT } from './route';

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

const validBody = {
  playedAt: '2026-10-30T14:00:00+08:00',
  roomFee: 40,
  note: '修改后的局',
  records: [
    { userId: 1, amount: 100 },
    { userId: 2, amount: -140 },
  ],
};

function callPut(id: number, body: unknown) {
  const req = new NextRequest(`http://localhost/api/games/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(req, { params: Promise.resolve({ id: String(id) }) });
}

function callDelete(id: number) {
  const req = new NextRequest(`http://localhost/api/games/${id}`, { method: 'DELETE' });
  return DELETE(req, { params: Promise.resolve({ id: String(id) }) });
}

describe('PUT /api/games/[id]', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非管理员不能修改战绩', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await callPut(9, validBody);

    expect(res.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('无效场次 ID 返回 400', async () => {
    const res = await callPut(Number.NaN, validBody);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '无效的场次 ID' });
  });

  it('开局时间超出合理范围返回 400，不触库', async () => {
    const res = await callPut(9, { ...validBody, playedAt: '2101-01-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '开局时间超出合理范围（2000 ~ 2100 年）' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('场次不存在返回 404', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await callPut(999, validBody);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '场次记录不存在' });
  });

  it('编辑历史场次：原停用玩家放行，新玩家须启用，重插记录重算大赢家', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/UPDATE games/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (/SELECT user_id FROM game_records/.test(sql)) {
        // 原对局玩家 1、2（其中 2 已被停用）
        return Promise.resolve({ rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 });
      }
      if (/FROM users WHERE id = ANY/.test(sql)) {
        // 新名单 1、2、3：2 停用但在放行名单内，3 启用
        return Promise.resolve({
          rows: [
            { id: 1, is_active: true },
            { id: 2, is_active: false },
            { id: 3, is_active: true },
          ],
          rowCount: 3,
        });
      }
      if (/DELETE FROM game_records/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 2 });
      }
      if (/INSERT INTO game_records/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 3 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });

    const res = await callPut(9, {
      ...validBody,
      records: [
        { userId: 1, amount: 100 },
        { userId: 2, amount: -60 },
        { userId: 3, amount: -80 },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 9, ok: true });
    // 停用玩家 2 在放行名单中，校验查询应包含全部三人
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ANY'), [
      [1, 2, 3],
    ]);
  });

  it('新增停用玩家被拒绝', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/UPDATE games/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (/SELECT user_id FROM game_records/.test(sql)) {
        return Promise.resolve({ rows: [{ user_id: 1 }], rowCount: 1 });
      }
      if (/FROM users WHERE id = ANY/.test(sql)) {
        return Promise.resolve({
          rows: [
            { id: 1, is_active: true },
            { id: 5, is_active: false },
          ],
          rowCount: 2,
        });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });

    const res = await callPut(9, {
      ...validBody,
      records: [
        { userId: 1, amount: 100 },
        { userId: 5, amount: -140 },
      ],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '包含不可用的玩家，请刷新玩家列表后重试' });
  });
});

describe('DELETE /api/games/[id]', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非管理员不能删除战绩', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await callDelete(9);

    expect(res.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('删除成功返回 ok', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await callDelete(9);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledWith('DELETE FROM games WHERE id = $1', [9]);
  });

  it('场次不存在返回 404', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await callDelete(999);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '场次记录不存在' });
  });
});
