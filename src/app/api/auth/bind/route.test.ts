// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createDeviceSession: vi.fn(),
  setDeviceCookie: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
  createDeviceSession: mocks.createDeviceSession,
  setDeviceCookie: mocks.setDeviceCookie,
}));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

import { clearFailures, recordFailure } from '@/lib/rateLimit';
import { POST } from './route';

const XFF = { 'x-forwarded-for': '203.0.113.9' };
const IP_KEY = 'bind:ip:203.0.113.9';

function bindReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const activeUserRow = {
  rows: [
    {
      id: 5,
      username: 'laowang',
      nickname: '老王',
      role: 'PLAYER',
      avatar_color: 'red',
      is_active: true,
    },
  ],
  rowCount: 1,
};

describe('POST /api/auth/bind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFailures(IP_KEY);
    clearFailures('bind:ip:203.0.113.8');
    clearFailures('bind:ip:');
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createDeviceSession.mockResolvedValue('d'.repeat(64));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('缺少绑定凭证返回 400', async () => {
    const res = await POST(bindReq({ bindToken: '' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '缺少专属绑定凭证' });
  });

  it('非法 JSON 请求体返回 400', async () => {
    const res = await POST(bindReq('{not-json'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '请求体格式无效' });
  });

  it('无效 bind_token 返回 401 并计入失败，同 IP 连续 10 次后 429', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(bindReq({ bindToken: 'bad-token' }, XFF));
      expect(res.status).toBe(401);
    }

    const res = await POST(bindReq({ bindToken: 'bad-token' }, XFF));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('尝试次数过多');
  });

  it('无 x-forwarded-for（直连部署）时跳过失败计数，不集体锁定', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    // 连续 12 次失败远超阈值，但无 IP 时不应共享同一个桶
    for (let i = 0; i < 12; i += 1) {
      const res = await POST(bindReq({ bindToken: 'bad-token' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain('绑定链接已失效');
    }
  });

  it('已停用账号的 bind_token 返回 401', async () => {
    mocks.query.mockResolvedValue({
      ...activeUserRow,
      rows: [{ ...activeUserRow.rows[0], is_active: false }],
    });

    const res = await POST(bindReq({ bindToken: 'token-of-suspended' }, XFF));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '该账号已停用，请联系管理员重新获取链接' });
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('绑定成功：创建设备会话、设置 Cookie 并返回用户信息', async () => {
    mocks.query.mockResolvedValue(activeUserRow);

    const res = await POST(bindReq({ bindToken: 'valid-token' }, XFF));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceToken).toBe('d'.repeat(64));
    expect(body.user.nickname).toBe('老王');
    expect(body.user.bindToken).toBeUndefined();
    expect(mocks.createDeviceSession).toHaveBeenCalledWith(5, '');
    expect(mocks.setDeviceCookie).toHaveBeenCalledTimes(1);
  });

  it('当前会话已是同一用户时复用设备 Token，不新增设备行', async () => {
    mocks.query.mockResolvedValue(activeUserRow);
    mocks.getCurrentUser.mockResolvedValue({ id: 5, deviceToken: 'current-token' });

    const res = await POST(bindReq({ bindToken: 'valid-token' }, XFF));

    expect(res.status).toBe(200);
    expect((await res.json()).deviceToken).toBe('current-token');
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('失败限流锁定期间直接 429，不落库', async () => {
    for (let i = 0; i < 10; i += 1) {
      recordFailure(IP_KEY, 10);
    }

    const res = await POST(bindReq({ bindToken: 'valid-token' }, XFF));

    expect(res.status).toBe(429);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
