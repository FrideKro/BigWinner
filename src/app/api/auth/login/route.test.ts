// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  createDeviceSession: vi.fn(),
  setDeviceCookie: vi.fn(),
  getPasswordLoginEnabled: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare, hash: mocks.hash } }));
vi.mock('@/lib/auth', () => ({
  createDeviceSession: mocks.createDeviceSession,
  setDeviceCookie: mocks.setDeviceCookie,
}));
vi.mock('../../_lib/shared', () => ({
  getPasswordLoginEnabled: mocks.getPasswordLoginEnabled,
}));

import { clearFailures } from '@/lib/rateLimit';
import { GET, POST } from './route';

function loginReq(username: string, password: string) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        id: 1,
        username: 'fride',
        nickname: '花非花',
        password_hash: '$2a$10$hash',
        role: 'ADMIN',
        avatar_color: 'red',
        is_active: true,
        bind_token: 'bind-token',
        ...overrides,
      },
    ],
    rowCount: 1,
  };
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.compare.mockReset();
    mocks.createDeviceSession.mockReset();
    mocks.setDeviceCookie.mockReset();
    mocks.getPasswordLoginEnabled.mockReset();
    mocks.getPasswordLoginEnabled.mockResolvedValue(true);
    mocks.createDeviceSession.mockResolvedValue('d'.repeat(64));
    clearFailures('login:ip:lockeduser:');
    clearFailures('login:user:lockeduser');
    clearFailures('login:ip:fride:');
    clearFailures('login:user:fride');
    clearFailures('login:ip:player1:');
    clearFailures('login:user:player1');
  });

  it('缺账号或密码返回 400', async () => {
    const res = await POST(loginReq('', 'x'));
    expect(res.status).toBe(400);
  });

  it('非法 JSON 请求体返回 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: '{not-json' }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '请求体格式无效' });
  });

  it('用户不存在返回 401 且文案不暴露存在性', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await POST(loginReq('nouser', 'pw'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '账号或密码错误' });
  });

  it('密码错误返回 401 并计入限流', async () => {
    mocks.query.mockResolvedValue(userRow());
    mocks.compare.mockResolvedValue(false);

    const res = await POST(loginReq('badpw', 'wrong'));

    expect(res.status).toBe(401);
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('超长账号或密码直接返回 401，不进数据库与 bcrypt', async () => {
    const resLongPw = await POST(loginReq('fride', 'p'.repeat(73)));
    expect(resLongPw.status).toBe(401);
    expect(await resLongPw.json()).toEqual({ error: '账号或密码错误' });

    const resLongUser = await POST(loginReq('u'.repeat(65), '123456'));
    expect(resLongUser.status).toBe(401);

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it('成功登录：创建设备会话、设置 Cookie 并返回用户（不含 bindToken）与明文 Token', async () => {
    mocks.query.mockResolvedValue(userRow());
    mocks.compare.mockResolvedValue(true);

    const res = await POST(loginReq('fride', 'correct'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceToken).toBe('d'.repeat(64));
    expect(body.user.nickname).toBe('花非花');
    expect(body.user.bindToken).toBeUndefined();
    expect(mocks.createDeviceSession).toHaveBeenCalledWith(1, '');
    expect(mocks.setDeviceCookie).toHaveBeenCalledTimes(1);
  });

  it('已停用账号（密码正确）返回 401 停用提示且不创建会话', async () => {
    mocks.query.mockResolvedValue(userRow({ is_active: false }));
    mocks.compare.mockResolvedValue(true);

    const res = await POST(loginReq('suspended', 'correct'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '该账号已停用，请联系管理员' });
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('普通玩家密码登录关闭时返回 403 且不创建会话', async () => {
    mocks.query.mockResolvedValue(userRow({ role: 'PLAYER' }));
    mocks.compare.mockResolvedValue(true);
    mocks.getPasswordLoginEnabled.mockResolvedValue(false);

    const res = await POST(loginReq('player1', 'correct'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: '密码登录已关闭，请使用管理员分享的免密登录链接',
    });
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('管理员不受密码登录开关限制', async () => {
    mocks.query.mockResolvedValue(userRow());
    mocks.compare.mockResolvedValue(true);
    mocks.getPasswordLoginEnabled.mockResolvedValue(false);

    const res = await POST(loginReq('fride', 'correct'));

    expect(res.status).toBe(200);
    expect(mocks.createDeviceSession).toHaveBeenCalledTimes(1);
  });

  it('密码登录关闭时密码错误仍返回通用 401，不暴露开关与角色', async () => {
    mocks.query.mockResolvedValue(userRow({ role: 'PLAYER' }));
    mocks.compare.mockResolvedValue(false);
    mocks.getPasswordLoginEnabled.mockResolvedValue(false);

    const res = await POST(loginReq('player1', 'wrong'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '账号或密码错误' });
    expect(mocks.createDeviceSession).not.toHaveBeenCalled();
  });

  it('同一账号连续失败 5 次后触发 429 限流', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

    for (let i = 0; i < 5; i += 1) {
      const res = await POST(loginReq('lockeduser', 'wrong'));
      expect(res.status).toBe(401);
    }

    const res = await POST(loginReq('lockeduser', 'wrong'));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('尝试次数过多');
  });
});

describe('GET /api/auth/login', () => {
  beforeEach(() => {
    mocks.getPasswordLoginEnabled.mockReset();
  });

  it('公开返回玩家密码登录开关', async () => {
    mocks.getPasswordLoginEnabled.mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ passwordLoginEnabled: false });
  });
});
