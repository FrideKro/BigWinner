// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  setDeviceCookie: vi.fn(),
  hashToken: vi.fn(),
  query: vi.fn(),
  generateToken: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
  setDeviceCookie: mocks.setDeviceCookie,
  hashToken: mocks.hashToken,
}));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  generateToken: mocks.generateToken,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    fn({ query: mocks.query }),
}));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare, hash: mocks.hash } }));

import { GET, PATCH } from './route';

const me = {
  id: 7,
  username: 'fride',
  nickname: '花非花',
  role: 'PLAYER' as const,
  avatarColor: 'blue',
  isActive: true,
  bindToken: 'bind-token-7',
  deviceToken: 't'.repeat(64),
};

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPatch(body: unknown) {
  return PATCH(patchReq(body), { params: Promise.resolve({}) });
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(me);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('返回当前用户与明文设备 Token，并顺延 Cookie', async () => {
    const res = await GET(new NextRequest('http://localhost/api/auth/me'), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.nickname).toBe('花非花');
    expect(body.user.bindToken).toBeUndefined();
    expect(body.deviceToken).toBe(me.deviceToken);
    expect(mocks.setDeviceCookie).toHaveBeenCalledTimes(1);
  });

  it('未登录返回 401', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/auth/me'), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(me);
    mocks.generateToken.mockReturnValue('rotated-bind-token');
    mocks.hashToken.mockReturnValue('hashed-current-device');
    mocks.hash.mockResolvedValue('$2a$10$newhash');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('修改昵称成功', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/SET nickname = COALESCE/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });
    mocks.getCurrentUser.mockResolvedValue({ ...me, nickname: '新昵称' });

    const res = await callPatch({ nickname: '新昵称' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      id: 7,
      username: 'fride',
      nickname: '新昵称',
      role: 'PLAYER',
      avatarColor: 'blue',
      isActive: true,
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('SET nickname = COALESCE'), [
      '新昵称',
      null,
      7,
    ]);
  });

  it('设置头像图片：显式 SET avatar_image（非 COALESCE）', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/SET avatar_image = \$1/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });
    const dataUrl = 'data:image/jpeg;base64,QQ==';
    mocks.getCurrentUser.mockResolvedValue(me);

    const res = await callPatch({ avatarImage: dataUrl });

    expect(res.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('SET avatar_image = $1, avatar_version = avatar_version + 1'),
      [dataUrl, 7],
    );
  });

  it('avatarImage 传 null 清除头像图片', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/SET avatar_image = \$1/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });
    mocks.getCurrentUser.mockResolvedValue(me);

    const res = await callPatch({ avatarImage: null });

    expect(res.status).toBe(200);
    // 清除同样递增版本号，客户端本地缓存据此失效
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('SET avatar_image = $1, avatar_version = avatar_version + 1'),
      [null, 7],
    );
  });

  it('头像图片前缀非法返回 400，不落库', async () => {
    const res = await callPatch({ avatarImage: 'https://example.com/a.jpg' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '头像图片无效或过大，请重新选择' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('头像图片超长返回 400，不落库', async () => {
    const res = await callPatch({
      avatarImage: 'data:image/jpeg;base64,' + 'a'.repeat(40000),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '头像图片无效或过大，请重新选择' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('修改密码：轮换 bind_token、下线其他设备并保留当前设备', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/SELECT password_hash FROM users/.test(sql)) {
        return Promise.resolve({ rows: [{ password_hash: '$2a$10$oldhash' }], rowCount: 1 });
      }
      if (/bind_token = \$2/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (/device_token <> \$2/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });
    mocks.compare.mockResolvedValue(true);
    mocks.getCurrentUser.mockResolvedValue(me);

    const res = await callPatch({ currentPassword: 'old-pass', newPassword: 'new-pass-123' });

    expect(res.status).toBe(200);
    // 原密码校验
    expect(mocks.compare).toHaveBeenCalledWith('old-pass', '$2a$10$oldhash');
    // bind_token 轮换
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('bind_token = $2'), [
      '$2a$10$newhash',
      'rotated-bind-token',
      7,
    ]);
    // 保留当前设备：仅删除 device_token 不同的其他设备
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('device_token <> $2'), [
      7,
      'hashed-current-device',
    ]);
  });

  it('原密码不正确返回 400，不进入更新事务', async () => {
    mocks.query.mockImplementation((sql: string) => {
      if (/SELECT password_hash FROM users/.test(sql)) {
        return Promise.resolve({ rows: [{ password_hash: '$2a$10$oldhash' }], rowCount: 1 });
      }
      throw new Error(`未预期的 SQL: ${sql}`);
    });
    mocks.compare.mockResolvedValue(false);

    const res = await callPatch({ currentPassword: 'wrong', newPassword: 'new-pass-123' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '原密码不正确' });
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it('修改密码必须提供原密码', async () => {
    const res = await callPatch({ newPassword: 'new-pass-123' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '修改密码必须输入当前原密码' });
  });

  it('新密码长度不足返回 400', async () => {
    const res = await callPatch({ currentPassword: 'old-pass', newPassword: '123' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '新密码长度至少为 4 位' });
  });

  it('昵称为空返回 400', async () => {
    const res = await callPatch({ nickname: '   ' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '昵称不能为空' });
  });
});
