// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
  generateToken: vi.fn(),
  hash: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser, hashToken: mocks.hashToken }));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  generateToken: mocks.generateToken,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    fn({ query: mocks.query }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash, compare: vi.fn() } }));

import { PATCH } from './route';

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

function patchReq(id: number, body: unknown) {
  return new NextRequest(`http://localhost/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPatch(id: number, body: unknown) {
  return PATCH(patchReq(id, body), { params: Promise.resolve({ id: String(id) }) });
}

// 按 SQL 片段分发 mock 结果（匹配顺序即优先级， Specific 在前）
function mockSql(routes: Array<{ match: RegExp; result: unknown }>) {
  mocks.query.mockImplementation((sql: string) => {
    const hit = routes.find((r) => r.match.test(sql));
    if (!hit) throw new Error(`未预期的 SQL: ${sql}`);
    return Promise.resolve(
      typeof hit.result === 'function' ? (hit.result as () => unknown)() : hit.result,
    );
  });
}

function updatedUserRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        id: 2,
        username: 'player2',
        nickname: '玩家二号',
        role: 'PLAYER',
        avatar_color: 'red',
        is_active: true,
        bind_token: 'bind-token-2',
        created_at: '2026-01-01T00:00:00Z',
        ...overrides,
      },
    ],
    rowCount: 1,
  };
}

describe('PATCH /api/users/[id]', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.generateToken.mockReset();
    mocks.hash.mockReset();
    mocks.hashToken.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.generateToken.mockReturnValue('new-bind-token');
    mocks.hashToken.mockReturnValue('hashed-current-token');
    mocks.hash.mockResolvedValue('$2a$10$newhash');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非管理员不能修改玩家账号', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await callPatch(2, { nickname: '改名' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '仅管理员可修改玩家账号' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('停用唯一「启用中」的管理员被拒绝（防管理入口全灭）', async () => {
    mockSql([
      { match: /FOR UPDATE/, result: { rows: [], rowCount: 0 } },
      { match: /is_active = TRUE AND id != \$1/, result: { rows: [{ count: '0' }], rowCount: 1 } },
    ]);

    const res = await callPatch(1, { isActive: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '必须保留至少一位启用中的管理员，无法停用' });
  });

  it('存在另一位启用中的管理员时停用成功', async () => {
    mockSql([
      { match: /FOR UPDATE/, result: { rows: [], rowCount: 0 } },
      { match: /is_active = TRUE AND id != \$1/, result: { rows: [{ count: '1' }], rowCount: 1 } },
      { match: /SET username = COALESCE/, result: updatedUserRow({ is_active: false }) },
    ]);

    const res = await callPatch(2, { isActive: false });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.isActive).toBe(false);
  });

  it('降级最后一位管理员仍被拒绝（回归守卫）', async () => {
    mockSql([
      { match: /FOR UPDATE/, result: { rows: [], rowCount: 0 } },
      {
        match: /role = 'ADMIN' AND id != \$1/,
        result: { rows: [{ count: '0' }], rowCount: 1 },
      },
    ]);

    const res = await callPatch(1, { role: 'PLAYER' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '系统中必须保留至少一位管理员，无法降级' });
  });

  it('管理员重置自己的密码保留当前设备会话，避免自登出', async () => {
    mockSql([
      { match: /UPDATE users SET bind_token/, result: { rows: [], rowCount: 1 } },
      { match: /UPDATE users SET password_hash/, result: { rows: [], rowCount: 1 } },
      {
        match: /device_token <> \$2/,
        result: { rows: [], rowCount: 0 },
      },
      { match: /SET username = COALESCE/, result: updatedUserRow({ id: 1, role: 'ADMIN' }) },
    ]);

    const res = await callPatch(1, { password: 'newpass123' });

    expect(res.status).toBe(200);
    // 轮换 bind_token
    expect(mocks.generateToken).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('bind_token'), [
      'new-bind-token',
      1,
    ]);
    // 保留当前设备：仅删除 device_token 不同于当前会话的设备
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('device_token <> $2'), [
      1,
      'hashed-current-token',
    ]);
  });

  it('重置他人密码则下线其全部设备', async () => {
    mockSql([
      { match: /UPDATE users SET bind_token/, result: { rows: [], rowCount: 1 } },
      { match: /UPDATE users SET password_hash/, result: { rows: [], rowCount: 1 } },
      { match: /DELETE FROM user_devices WHERE user_id = \$1$/, result: { rows: [], rowCount: 2 } },
      { match: /SET username = COALESCE/, result: updatedUserRow() },
    ]);

    const res = await callPatch(2, { password: 'newpass123' });

    expect(res.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM user_devices WHERE user_id = \$1$/),
      [2],
    );
  });

  it('目标玩家不存在返回 404', async () => {
    mockSql([{ match: /SET username = COALESCE/, result: { rows: [], rowCount: 0 } }]);

    const res = await callPatch(999, { nickname: '不存在' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '玩家不存在' });
  });

  it('用户名被占用返回 409', async () => {
    mockSql([
      {
        match: /LOWER\(username\) = LOWER\(\$1\) AND id != \$2/,
        result: { rows: [{ id: 3 }], rowCount: 1 },
      },
    ]);

    const res = await callPatch(2, { username: 'taken' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '登录账号 "taken" 已被占用' });
  });
});
