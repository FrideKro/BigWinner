// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  query: mocks.query,
  generateToken: vi.fn(() => `${'a'.repeat(31)}b`),
}));

import { createDeviceSession, hashToken, verifyAndExtendDeviceToken } from './auth';

const PLAIN_TOKEN = 'f'.repeat(64);
const TOKEN_HASH = hashToken(PLAIN_TOKEN);

function activeUserRow() {
  return {
    rows: [
      {
        id: 1,
        username: 'fride',
        nickname: '花非花',
        role: 'ADMIN',
        avatar_color: 'red',
        is_active: true,
        bind_token: 'bind-token',
        device_token: TOKEN_HASH,
      },
    ],
    rowCount: 1,
  };
}

describe('hashToken', () => {
  it('输出稳定的 SHA-256 十六进制哈希', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('不同输入哈希不同，长度固定 64 字符', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken(PLAIN_TOKEN)).toHaveLength(64);
  });
});

describe('createDeviceSession', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('入库的是 Token 哈希而非明文，返回值为明文', async () => {
    const token = await createDeviceSession(1, 'Mozilla/5.0');

    expect(token).toBe(`${'a'.repeat(31)}b`);
    const insertCall = mocks.query.mock.calls.find((args) => args[0].includes('INSERT INTO'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([1, hashToken(token), 'Mozilla/5.0']);
    expect(insertCall![1][1]).not.toBe(token);
  });

  it('user_agent 超长时截断到 500 字符', async () => {
    await createDeviceSession(1, 'x'.repeat(600));

    const insertCall = mocks.query.mock.calls.find((args) => args[0].includes('INSERT INTO'));
    expect(insertCall![1][2]).toHaveLength(500);
  });
});

describe('verifyAndExtendDeviceToken', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('按哈希查询凭据，命中后返回明文 Token 与用户信息', async () => {
    mocks.query
      .mockResolvedValueOnce(activeUserRow())
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const user = await verifyAndExtendDeviceToken(PLAIN_TOKEN);

    expect(user).not.toBeNull();
    expect(user!.deviceToken).toBe(PLAIN_TOKEN);
    expect(user!.nickname).toBe('花非花');
    // 认证查询与滑动续期 UPDATE 均以哈希作为查询参数
    expect(mocks.query.mock.calls[0][1]).toEqual([TOKEN_HASH]);
    expect(mocks.query.mock.calls[1][0]).toContain('UPDATE user_devices');
    expect(mocks.query.mock.calls[1][1]).toEqual([TOKEN_HASH]);
  });

  it('停用玩家（is_active 过滤后无行）返回 null，且不触发续期写入', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const user = await verifyAndExtendDeviceToken(PLAIN_TOKEN);

    expect(user).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('过期设备（expires_at 判定后无行）返回 null', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await verifyAndExtendDeviceToken(PLAIN_TOKEN)).toBeNull();
  });

  it('空 Token 直接返回 null，不触达数据库', async () => {
    expect(await verifyAndExtendDeviceToken('')).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
