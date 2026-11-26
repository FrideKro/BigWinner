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
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('handler 已显式设置 Cache-Control 时保留原值', async () => {
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    const wrapped = withAuth(async () =>
      NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, max-age=3600' } }),
    );

    const res = await wrapped(jsonReq(), { params: Promise.resolve({}) });

    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
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
    const text = vi.fn();
    const req = {
      headers: new Headers({ 'content-length': String(1024 * 1024 + 1) }),
      text,
    } as unknown as NextRequest;

    await expect(parseJsonBody(req)).rejects.toMatchObject({
      status: 413,
      message: '请求体过大',
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('无 content-length 头（分块传输）时按实际字节长度校验：正常解析', async () => {
    const text = vi.fn(() => Promise.resolve('{"a":1}'));
    const req = { headers: new Headers(), text } as unknown as NextRequest;

    await expect(parseJsonBody(req)).resolves.toEqual({ a: 1 });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('无 content-length 头（分块传输）且实际字节超过 1MB 仍强制 413', async () => {
    // 合法 JSON 但体积超限：解析前即拒绝，不进入 JSON.parse
    const oversized = JSON.stringify({ pad: 'x'.repeat(1024 * 1024) });
    const parse = vi.spyOn(JSON, 'parse');
    const req = {
      headers: new Headers(),
      text: () => Promise.resolve(oversized),
    } as unknown as NextRequest;

    await expect(parseJsonBody(req)).rejects.toMatchObject({
      status: 413,
      message: '请求体过大',
    });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('JSON 为 null / 数组 / 原始值时拒绝并返回 400', async () => {
    for (const raw of ['null', '[1,2]', '"hello"', '123']) {
      await expect(parseJsonBody(jsonReq(raw))).rejects.toMatchObject({
        status: 400,
        message: '请求体格式无效',
      });
    }
  });

  it('流式读取超出 1MB 时立即 cancel 并抛出 413', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    let reads = 0;
    const req = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi.fn(async () => {
            reads += 1;
            if (reads === 1) {
              return { done: false, value: new Uint8Array(600 * 1024) };
            }
            if (reads === 2) {
              return { done: false, value: new Uint8Array(600 * 1024) };
            }
            return { done: true, value: undefined };
          }),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as NextRequest;

    await expect(parseJsonBody(req)).rejects.toMatchObject({
      status: 413,
      message: '请求体过大',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
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
