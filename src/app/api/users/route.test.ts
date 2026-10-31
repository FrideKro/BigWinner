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
    const res = await POST(postReq({ username: 'p1', nickname: '玩家一', isActive: 'false' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'isActive 参数无效' });
    expect(mocks.query).not.toHaveBeenCalled();
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

    const res = await POST(postReq({ username: 'p1', nickname: '玩家一' }), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.bindToken).toBe('new-bind-token');
    expect(body.user.isActive).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      ['p1', '玩家一', '$2a$10$newhash', 'PLAYER', 'red', true, 'new-bind-token'],
    );
  });
});
