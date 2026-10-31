// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { ApiError, parseJsonBody, withAuth } from './handler';
import { toPublicUser } from './shared';

const adminUser = {
  id: 1,
  username: 'fride',
  nickname: '花非花',
  role: 'ADMIN' as const,
  avatarColor: 'red',
  isActive: true,
  bindToken: 'secret-bind-token',
  deviceToken: 't'.repeat(64),
};

const playerUser = { ...adminUser, id: 2, role: 'PLAYER' as const };

function jsonReq(body?: string) {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
  });
}

describe('withAuth', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('未登录返回 401，handler 不执行', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('非管理员访问 admin 接口返回 403 及指定文案', async () => {
    mocks.getCurrentUser.mockResolvedValue(playerUser);
    const wrapped = withAuth(async () => NextResponse.json({ ok: true }), {
      admin: '仅管理员可录入战绩',
    });

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '仅管理员可录入战绩' });
  });

  it('管理员身份放行 admin 接口', async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    const wrapped = withAuth(async () => NextResponse.json({ ok: true }), {
      admin: '仅管理员可录入战绩',
    });

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
  });

  it('ApiError 转换为对应状态码与消息', async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    const wrapped = withAuth(async () => {
      throw new ApiError(409, '登录账号 "x" 已被占用');
    });

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '登录账号 "x" 已被占用' });
  });

  it('未知异常返回 500 及 error 文案，并记录服务端日志', async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    const wrapped = withAuth(
      async () => {
        throw new Error('boom');
      },
      { error: '保存场次战绩失败' },
    );

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '保存场次战绩失败' });
  });

  it('动态路由参数透传给 handler', async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    const wrapped = withAuth<{ id: string }>(async (_req, _user, { params }) => {
      const { id } = await params;
      return NextResponse.json({ id });
    });

    const res = await wrapped(jsonReq(), { params: Promise.resolve({ id: '42' }) });

    expect(await res.json()).toEqual({ id: '42' });
  });
});

describe('parseJsonBody', () => {
  it('合法 JSON 正常解析', async () => {
    const body = await parseJsonBody(jsonReq('{"a":1}'));
    expect(body).toEqual({ a: 1 });
  });

  it('非法 JSON 抛出 400 ApiError', async () => {
    await expect(parseJsonBody(jsonReq('{not-json'))).rejects.toMatchObject({
      status: 400,
      message: '请求体格式无效',
    });
  });

  it('content-length 超过 1MB 抛出 413 ApiError，不读取 body', async () => {
    const json = vi.fn();
    const req = {
      headers: new Headers({ 'content-length': String(1024 * 1024 + 1) }),
      json,
    } as unknown as NextRequest;

    await expect(parseJsonBody(req)).rejects.toMatchObject({
      status: 413,
      message: '请求体过大',
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('无 content-length 头（分块传输）跳过大小拦截正常解析', async () => {
    const json = vi.fn(() => Promise.resolve({ a: 1 }));
    const req = { headers: new Headers(), json } as unknown as NextRequest;

    await expect(parseJsonBody(req)).resolves.toEqual({ a: 1 });
    expect(json).toHaveBeenCalledTimes(1);
  });
});

describe('toPublicUser', () => {
  it('裁剪 bindToken 与 deviceToken 等内部凭证字段', () => {
    const pub = toPublicUser(adminUser);
    expect(pub).toEqual({
      id: 1,
      username: 'fride',
      nickname: '花非花',
      role: 'ADMIN',
      avatarColor: 'red',
      isActive: true,
    });
    expect('bindToken' in pub).toBe(false);
    expect('deviceToken' in pub).toBe(false);
  });
});
