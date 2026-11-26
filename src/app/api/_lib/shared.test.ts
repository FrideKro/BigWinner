// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ query: mocks.query }));

import {
  getDefaultRoomFee,
  getPasswordLoginEnabled,
  getSystemSettings,
  invalidateSystemSettingsCache,
} from './shared';

describe('getSystemSettings 进程内缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    invalidateSystemSettingsCache();
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({
      rows: [
        { key: 'default_room_fee', value: '80' },
        { key: 'password_login_enabled', value: 'true' },
      ],
      rowCount: 2,
    });
  });

  afterEach(() => {
    invalidateSystemSettingsCache();
    vi.useRealTimers();
  });

  it('TTL 60s 内命中缓存只查一次数据库，过期后重新查询', async () => {
    expect(await getSystemSettings()).toEqual({
      defaultRoomFee: 80,
      passwordLoginEnabled: true,
    });
    expect(await getDefaultRoomFee()).toBe(80);
    expect(await getPasswordLoginEnabled()).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await getSystemSettings();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('invalidateSystemSettingsCache 立即清缓存', async () => {
    await getSystemSettings();
    expect(mocks.query).toHaveBeenCalledTimes(1);

    invalidateSystemSettingsCache();
    await getSystemSettings();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
