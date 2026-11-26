// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  on: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(function () {
    return { connect: mocks.connect, query: mocks.poolQuery, on: mocks.on };
  }),
}));

import { ensureDbInitialized, getPool } from './db';

// 模拟「库表齐全、管理员存在、无缺失 token」的健康数据库
function healthyClient() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
      if (sql.includes("role = 'ADMIN'")) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
}

describe('数据库初始化', () => {
  beforeEach(() => {
    global.__bigWinnerPool = undefined;
    global.__bigWinnerInitPromise = undefined;
    mocks.connect.mockReset();
    mocks.on.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('取连接失败后不缓存失败结果，下次调用会重新初始化', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = healthyClient();
    mocks.connect.mockResolvedValueOnce(client);

    await expect(ensureDbInitialized()).rejects.toThrow('ECONNREFUSED');
    expect(global.__bigWinnerInitPromise).toBeUndefined();

    await expect(ensureDbInitialized()).resolves.toBeUndefined();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('初始化成功后复用同一个 Promise，不重复建表', async () => {
    mocks.connect.mockResolvedValue(healthyClient());

    await ensureDbInitialized();
    await ensureDbInitialized();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it('事务内失败时即使 ROLLBACK 也失败，仍抛出原始错误、释放连接并允许重试', async () => {
    const broken = healthyClient();
    broken.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      if (sql.includes('information_schema.tables')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    mocks.connect.mockResolvedValueOnce(broken);

    await expect(ensureDbInitialized()).rejects.toThrow('boom');
    expect(broken.release).toHaveBeenCalledTimes(1);
    expect(global.__bigWinnerInitPromise).toBeUndefined();
  });

  it('连接池挂载 error 监听，避免空闲连接异常导致进程崩溃', () => {
    getPool();
    expect(mocks.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('用户名唯一索引创建失败时通过 SAVEPOINT 回滚并继续完成后续初始化', async () => {
    const client = healthyClient();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('idx_users_username_lower')) {
        throw new Error('could not create unique index');
      }
      if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
      if (sql.includes("role = 'ADMIN'")) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    mocks.connect.mockResolvedValueOnce(client);

    await expect(ensureDbInitialized()).resolves.toBeUndefined();
    const executedSql = client.query.mock.calls.map((c) => c[0] as string);
    expect(executedSql).toContain('SAVEPOINT sp_username_lower_idx');
    expect(executedSql).toContain('ROLLBACK TO SAVEPOINT sp_username_lower_idx');
    expect(executedSql).toContain('COMMIT');
    expect(warnSpy).toHaveBeenCalled();
  });
});
