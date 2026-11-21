// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
  generateToken: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({ query: mocks.query, generateToken: mocks.generateToken }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash, compare: vi.fn() } }));

import { POST } from './route';

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
  return new NextRequest('http://localhost/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/users', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.generateToken.mockReset();
    mocks.hash.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.generateToken.mockReturnValue('new-bind-token');
    mocks.hash.mockResolvedValue('$2a$10$newhash');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('非管理员不能创建玩家账号', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await POST(postReq({ username: 'p1', nickname: '玩家一' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('isActive 传非布尔值返回 400，不进入查重', async () => {
    const res = await POST(
      postReq({ username: 'p1', nickname: '玩家一', password: 'abc12345', isActive: 'false' }),
      {
        params: Promise.resolve({}),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'isActive 参数无效' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('未传初始密码：免密码建号成功，哈希落空串且不调 bcrypt', async () => {
    mocks.hash.mockClear();
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 5,
            username: 'p1',
            nickname: '玩家一',
            role: 'PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(postReq({ username: 'p1', nickname: '玩家一' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'p1',
      '玩家一',
      '',
      'PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });

  it('初始密码过短返回 400，不进入查重', async () => {
    const res = await POST(postReq({ username: 'p1', nickname: '玩家一', password: 'abc' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '初始密码长度至少为 4 位' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('role 传非法值返回 400，不进入查重', async () => {
    const res = await POST(
      postReq({ username: 'p2', nickname: '玩家二', password: 'abc12345', role: 'GUEST' }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'role 参数无效' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('不传 role 时默认按普通玩家创建', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 6,
            username: 'p2',
            nickname: '玩家二',
            role: 'PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(postReq({ username: 'p2', nickname: '玩家二', password: 'abc12345' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'p2',
      '玩家二',
      '$2a$10$newhash',
      'PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });

  it('创建临时玩家：role=TEMP_PLAYER 原样入库', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 7,
            username: 'tmp1',
            nickname: '临时玩家',
            role: 'TEMP_PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(
      postReq({
        username: 'tmp1',
        nickname: '临时玩家',
        password: 'abc12345',
        role: 'TEMP_PLAYER',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('TEMP_PLAYER');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'tmp1',
      '临时玩家',
      '$2a$10$newhash',
      'TEMP_PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });

  it('临时玩家免密码建号：密码留空入库空串哈希，不调 bcrypt', async () => {
    mocks.hash.mockClear();
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 8,
            username: 'tmp2',
            nickname: '免密临时',
            role: 'TEMP_PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(
      postReq({ username: 'tmp2', nickname: '免密临时', role: 'TEMP_PLAYER' }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'tmp2',
      '免密临时',
      '',
      'TEMP_PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });

  it('任意角色免密码建号：密码留空入库空串哈希，不调 bcrypt', async () => {
    mocks.hash.mockClear();
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 8,
            username: 'p4',
            nickname: '免密玩家',
            role: 'PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(postReq({ username: 'p4', nickname: '免密玩家', role: 'PLAYER' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'p4',
      '免密玩家',
      '',
      'PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });

  it('创建成功返回 201 与 bindToken，未传 isActive 时默认启用', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes('LOWER(username)')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({
        rows: [
          {
            id: 5,
            username: 'p1',
            nickname: '玩家一',
            role: 'PLAYER',
            avatar_color: 'red',
            is_active: true,
            bind_token: 'new-bind-token',
            created_at: '2026-10-31T00:00:00Z',
          },
        ],
        rowCount: 1,
      });
    });

    const res = await POST(postReq({ username: 'p1', nickname: '玩家一', password: 'abc12345' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.bindToken).toBe('new-bind-token');
    expect(body.user.isActive).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      'p1',
      '玩家一',
      '$2a$10$newhash',
      'PLAYER',
      'red',
      true,
      'new-bind-token',
    ]);
  });
});
