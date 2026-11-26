// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  setDeviceCookie: vi.fn(),
  listPlayers: vi.fn(),
  getSystemSettings: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
  setDeviceCookie: mocks.setDeviceCookie,
}));
vi.mock('../_lib/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/shared')>();
  return {
    ...actual,
    listPlayers: mocks.listPlayers,
    getSystemSettings: mocks.getSystemSettings,
  };
});

import { GET } from './route';

const adminUser = {
  id: 1,
  username: 'admin',
  nickname: '管理员',
  role: 'ADMIN' as const,
  avatarColor: 'amber',
  isActive: true,
  bindToken: 'secret-bind',
  deviceToken: 't'.repeat(64),
  needsExtend: true,
};

describe('GET /api/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(adminUser);
    mocks.listPlayers.mockResolvedValue([]);
    mocks.getSystemSettings.mockResolvedValue({
      defaultRoomFee: 100,
      passwordLoginEnabled: false,
    });
  });

  it('不下发明文 deviceToken 与 bindToken，needsExtend=true 时顺延 HttpOnly Cookie', async () => {
    const res = await GET(new NextRequest('http://localhost/api/bootstrap'), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.deviceToken).toBeUndefined();
    expect(body.user.bindToken).toBeUndefined();
    expect(body.user.nickname).toBe('管理员');
    expect(body.defaultRoomFee).toBe(100);
    expect(body.passwordLoginEnabled).toBe(false);
    expect(mocks.setDeviceCookie).toHaveBeenCalledWith(res, adminUser.deviceToken);
  });

  it('needsExtend=false 时不重复写 Set-Cookie', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...adminUser, needsExtend: false });

    const res = await GET(new NextRequest('http://localhost/api/bootstrap'), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(mocks.setDeviceCookie).not.toHaveBeenCalled();
  });

  it('未登录返回 401', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/bootstrap'), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(401);
    expect(mocks.setDeviceCookie).not.toHaveBeenCalled();
  });
});
