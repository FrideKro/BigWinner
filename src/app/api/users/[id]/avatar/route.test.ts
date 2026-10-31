// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hashToken: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser, hashToken: mocks.hashToken }));
vi.mock('@/lib/db', () => ({ query: mocks.query, withTransaction: vi.fn() }));

import { GET } from './route';

function callGet(id: number) {
  return GET(new NextRequest(`http://localhost/api/users/${id}/avatar?v=1`), {
    params: Promise.resolve({ id: String(id) }),
  });
}

describe('GET /api/users/[id]/avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('返回头像 data URL 与版本号', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: 'PLAYER' });
    mocks.query.mockResolvedValue({
      rows: [{ avatar_image: 'data:image/jpeg;base64,QQ==', avatar_version: 3 }],
      rowCount: 1,
    });

    const res = await callGet(2);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatar: 'data:image/jpeg;base64,QQ==', version: 3 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SELECT avatar_image'), [2]);
  });

  it('未设置头像返回 avatar null（客户端负缓存）', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: 'PLAYER' });
    mocks.query.mockResolvedValue({
      rows: [{ avatar_image: null, avatar_version: 0 }],
      rowCount: 1,
    });

    const res = await callGet(2);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatar: null, version: 0 });
  });

  it('玩家不存在返回 404', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: 'PLAYER' });
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await callGet(999);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '玩家不存在' });
  });

  it('无效玩家 ID 返回 400，不查库', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: 'PLAYER' });

    const res = await callGet(-1);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '无效的玩家 ID' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('未登录返回 401', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const res = await callGet(2);

    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
