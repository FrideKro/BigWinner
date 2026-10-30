// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  query: vi.fn(),
  getDefaultRoomFee: vi.fn(),
  getPasswordLoginEnabled: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/db', () => ({
  query: mocks.query,
  withTransaction: (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    fn({ query: mocks.query }),
}));
vi.mock('../_lib/shared', () => ({
  getDefaultRoomFee: mocks.getDefaultRoomFee,
  getPasswordLoginEnabled: mocks.getPasswordLoginEnabled,
}));

import { GET, PUT } from './route';

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

function settingsReq() {
  return new NextRequest('http://localhost/api/settings');
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPut(body: unknown) {
  return PUT(putReq(body), { params: Promise.resolve({}) });
}

describe('/api/settings', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.query.mockReset();
    mocks.getDefaultRoomFee.mockReset();
    mocks.getPasswordLoginEnabled.mockReset();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.getDefaultRoomFee.mockResolvedValue(100);
    mocks.getPasswordLoginEnabled.mockResolvedValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('GET 返回默认房费与密码登录开关', async () => {
    const res = await GET(settingsReq(), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultRoomFee: 100, passwordLoginEnabled: false });
  });

  it('PUT 仅更新密码登录开关', async () => {
    const res = await callPut({ passwordLoginEnabled: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultRoomFee: 100, passwordLoginEnabled: true });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('password_login_enabled'), [
      'true',
    ]);
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining('default_room_fee'),
      expect.anything(),
    );
  });

  it('PUT 支持关闭密码登录', async () => {
    mocks.getPasswordLoginEnabled.mockResolvedValue(true);

    const res = await callPut({ passwordLoginEnabled: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultRoomFee: 100, passwordLoginEnabled: false });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('password_login_enabled'), [
      'false',
    ]);
  });

  it('PUT 仍支持仅更新默认房费', async () => {
    const res = await callPut({ defaultRoomFee: 50 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultRoomFee: 50, passwordLoginEnabled: false });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('default_room_fee'), ['50']);
  });

  it('PUT 拒绝非布尔的密码登录开关', async () => {
    const res = await callPut({ passwordLoginEnabled: 'yes' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '密码登录开关必须为布尔值' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('PUT 拒绝空更新', async () => {
    const res = await callPut({});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '没有需要保存的设置' });
  });

  it('非管理员不能修改设置', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, role: 'PLAYER' });

    const res = await callPut({ passwordLoginEnabled: true });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '仅管理员可修改系统设置' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
