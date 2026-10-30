// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyAndExtendDeviceToken: vi.fn(),
  setDeviceCookie: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  verifyAndExtendDeviceToken: mocks.verifyAndExtendDeviceToken,
  setDeviceCookie: mocks.setDeviceCookie,
}));

import { clearFailures, recordFailure } from '@/lib/rateLimit';
import { POST } from './route';

const XFF = { 'x-forwarded-for': '203.0.113.10' };
const IP_KEY = 'restore:ip:203.0.113.10';

const restoredUser = {
  id: 5,
  username: 'laowang',
  nickname: '老王',
  role: 'PLAYER' as const,
  avatarColor: 'red',
  isActive: true,
  bindToken: null,
  deviceToken: 'd'.repeat(64),
};

function restoreReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/auth/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFailures(IP_KEY);
    clearFailures('restore:ip:');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('缺少本地凭证返回 401', async () => {
    const res = await POST(restoreReq({ deviceToken: '' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '无有效本地凭证' });
  });

  it('非法 JSON 请求体返回 400', async () => {
    const res = await POST(restoreReq('{not-json'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '请求体格式无效' });
  });

  it('无效凭证返回 401 并计入失败，同 IP 连续 10 次后 429', async () => {
    mocks.verifyAndExtendDeviceToken.mockResolvedValue(null);

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(restoreReq({ deviceToken: 'bad-token' }, XFF));
      expect(res.status).toBe(401);
    }

    const res = await POST(restoreReq({ deviceToken: 'bad-token' }, XFF));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('尝试次数过多');
  });

  it('无 x-forwarded-for（直连部署）时跳过失败计数，不集体锁定', async () => {
    mocks.verifyAndExtendDeviceToken.mockResolvedValue(null);

    for (let i = 0; i < 12; i += 1) {
      const res = await POST(restoreReq({ deviceToken: 'bad-token' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain('设备凭证已过期');
    }
  });

  it('恢复成功：返回用户与 Token 并设置 Cookie', async () => {
    mocks.verifyAndExtendDeviceToken.mockResolvedValue(restoredUser);

    const res = await POST(restoreReq({ deviceToken: restoredUser.deviceToken }, XFF));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceToken).toBe(restoredUser.deviceToken);
    expect(body.user.nickname).toBe('老王');
    expect(mocks.setDeviceCookie).toHaveBeenCalledTimes(1);
    expect(mocks.verifyAndExtendDeviceToken).toHaveBeenCalledWith(restoredUser.deviceToken);
  });

  it('失败限流锁定期间直接 429，不校验凭证', async () => {
    for (let i = 0; i < 10; i += 1) {
      recordFailure(IP_KEY, 10);
    }

    const res = await POST(restoreReq({ deviceToken: 'any-token' }, XFF));

    expect(res.status).toBe(429);
    expect(mocks.verifyAndExtendDeviceToken).not.toHaveBeenCalled();
  });

  it('服务端异常返回 500', async () => {
    mocks.verifyAndExtendDeviceToken.mockRejectedValue(new Error('db down'));

    const res = await POST(restoreReq({ deviceToken: 'any-token' }, XFF));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '恢复会话失败' });
  });
});
