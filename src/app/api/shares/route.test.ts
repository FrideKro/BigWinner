// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
  generateToken: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  generateToken: mocks.generateToken,
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
  return new NextRequest('http://localhost/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/shares POST', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.generateToken.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.generateToken.mockReturnValue('a1b2c3d4e5f60718');
    mocks.query.mockResolvedValue({ rows: [{ id: 9, code: 'a1b2c3d4e5f60718' }], rowCount: 1 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('创建周期分享：写入内容范围与固化周期，返回分享码', async () => {
    const res = await POST(
      postReq({
        contentScope: ['board', 'games'],
        periodType: 'period',
        period: '2026-10',
        expiresOn: '2027-06-01',
      }),
      {
        params: Promise.resolve({}),
      },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 9, code: 'a1b2c3d4e5f60718' });
    const [, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      'a1b2c3d4e5f60718',
      'board,games',
      'period',
      '2026-10',
      null,
      null,
      1,
      expect.any(Date),
    ]);
    // 有效期至所选日当天 24:00（上海）= UTC 当日 16:00
    expect((params[7] as Date).toISOString()).toBe('2027-06-01T16:00:00.000Z');
  });

  it('动态周期（本年）固化为具体年份', async () => {
    const res = await POST(
      postReq({
        contentScope: ['board'],
        periodType: 'period',
        period: 'year',
        expiresOn: null,
      }),
      {
        params: Promise.resolve({}),
      },
    );

    expect(res.status).toBe(201);
    const [, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toMatch(/^\d{4}$/);
    // 永久有效：expires_at 为 NULL
    expect(params[7]).toBeNull();
  });

  it('自定义区间写入起止日期', async () => {
    const res = await POST(
      postReq({
        contentScope: ['games'],
        periodType: 'range',
        rangeStart: '2026-10-01',
        rangeEnd: '2026-10-20',
        expiresOn: '2027-06-01',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    const [, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      'a1b2c3d4e5f60718',
      'games',
      'range',
      'all',
      '2026-10-01',
      '2026-10-20',
      1,
      expect.any(Date),
    ]);
    // 有效期按自然日：过期点恒为所选日当天 24:00（上海）= UTC 当日 16:00
    expect((params[7] as Date).toISOString()).toBe('2027-06-01T16:00:00.000Z');
  });

  it('拒绝非法参数', async () => {
    const cases = [
      { contentScope: [], periodType: 'period', period: 'all', expiresOn: null },
      { contentScope: ['board'], periodType: 'period', period: '2026-13', expiresOn: null },
      { contentScope: ['board'], periodType: 'week', expiresOn: null },
      {
        contentScope: ['board'],
        periodType: 'range',
        rangeStart: '2026-10-20',
        rangeEnd: '2026-10-01',
        expiresOn: null,
      },
      // 有效期：过去日期 / 不存在的日期 / 非法格式
      { contentScope: ['board'], periodType: 'period', period: 'all', expiresOn: '2020-01-01' },
      { contentScope: ['board'], periodType: 'period', period: 'all', expiresOn: '2026-02-30' },
      { contentScope: ['board'], periodType: 'period', period: 'all', expiresOn: 'abc' },
      { contentScope: ['board'], periodType: 'period', period: 'all', expiresOn: 7 },
    ];
    for (const body of cases) {
      const res = await POST(postReq(body), { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('非管理员不能创建分享', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await POST(
      postReq({ contentScope: ['board'], periodType: 'period', period: 'all', expiresOn: null }),
      {
        params: Promise.resolve({}),
      },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '仅管理员可创建分享链接' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe('/api/shares GET', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: 3,
          code: 'a1b2c3d4e5f60718',
          content_scope: 'board,games',
          period_type: 'range',
          period: 'all',
          range_start: '2026-10-01',
          range_end: '2026-10-20',
          expires_at: '2026-11-01T00:00:00.000Z',
          created_at: '2026-10-20T00:00:00.000Z',
        },
      ],
      rowCount: 1,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('返回最近分享的驼峰结构列表', async () => {
    const req = new NextRequest('http://localhost/api/shares');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { shares: Array<Record<string, unknown>> };
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0]).toMatchObject({
      id: 3,
      code: 'a1b2c3d4e5f60718',
      contentScope: ['board', 'games'],
      periodType: 'range',
      periodLabel: '2026-10-01 ~ 2026-10-20',
      expiresAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('非管理员不能查看分享列表', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const req = new NextRequest('http://localhost/api/shares');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
  });
});
