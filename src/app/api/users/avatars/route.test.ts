// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

import { GET } from './route';

function callGet(query = '') {
  return GET(new NextRequest(`http://localhost/api/users/avatars${query}`), {
    params: Promise.resolve({}),
  });
}

describe('GET /api/users/avatars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: 'PLAYER' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('未登录返回 401', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const res = await callGet('?ids=1,2');

    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('缺少或空 ids 返回 400', async () => {
    expect((await callGet('')).status).toBe(400);
    expect((await callGet('?ids= , ')).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('包含非法 ID 返回 400', async () => {
    const res = await callGet('?ids=1,abc');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '存在无效的玩家 ID' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('超过 50 个 ID 返回 400', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
    const res = await callGet(`?ids=${ids}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '单次最多查询 50 位玩家头像' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('去重后单条 SQL 批量返回头像映射', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        { id: 1, avatar_image: 'data:image/jpeg;base64,/9j/4AAQ', avatar_version: 2 },
        { id: 2, avatar_image: null, avatar_version: 1 },
      ],
      rowCount: 2,
    });

    const res = await callGet('?ids=1,2,1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      avatars: {
        '1': { avatar: 'data:image/jpeg;base64,/9j/4AAQ', version: 2 },
        '2': { avatar: null, version: 1 },
      },
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ANY($1)'), [
      [1, 2],
    ]);
  });
});
