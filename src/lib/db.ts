import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

declare global {
  var __bigWinnerPool: Pool | undefined;

  var __bigWinnerInitPromise: Promise<void> | undefined;
}

function createPool(): Pool {
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }

  const sslMode = (process.env.DB_SSLMODE || 'disable').toLowerCase();
  const ssl =
    sslMode === 'disable' || sslMode === 'false'
      ? false
      : { rejectUnauthorized: sslMode === 'verify-full' };

  return new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'big_winner',
    user: process.env.DB_USER || 'big_winner',
    password: process.env.DB_PASSWORD || '',
    ssl,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
}

export function getPool(): Pool {
  if (!global.__bigWinnerPool) {
    const pool = createPool();
    // 空闲连接被数据库端断开时 pg 会触发 error 事件；无监听器会变成未捕获异常导致进程崩溃
    pool.on('error', (err) => {
      console.error('PostgreSQL 空闲连接异常:', err.message);
    });
    global.__bigWinnerPool = pool;
  }
  return global.__bigWinnerPool;
}

export function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

async function runInitialization(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 使用应用专用咨询锁，防止多实例并发启动时发生 DDL 竞态
    await client.query('SELECT pg_advisory_xact_lock(749202)');

    // 检查核心表是否存在
    const checkRes = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists;
    `);

    const tablesExist = checkRes.rows[0]?.exists ?? false;

    // 注意：本 if 块仅负责全新数据库的首次建表。对已有库的 schema 演进
    // （新增列 / 新增索引）必须把幂等 DDL 追加在本块之外，否则不会生效
    if (!tablesExist) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(64) UNIQUE NOT NULL,
          nickname VARCHAR(64) NOT NULL,
          password_hash TEXT NOT NULL,
          role VARCHAR(16) NOT NULL DEFAULT 'PLAYER',
          avatar_color VARCHAR(32) NOT NULL DEFAULT 'red',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          bind_token VARCHAR(128) UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_devices (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- 存 SHA-256 哈希（64 字符 hex），明文 Token 只出现在 Cookie/响应中不落库
          device_token VARCHAR(128) UNIQUE NOT NULL,
          user_agent TEXT DEFAULT '',
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          played_at TIMESTAMPTZ NOT NULL,
          room_fee INTEGER NOT NULL CHECK (room_fee >= 0),
          note TEXT DEFAULT '',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS game_records (
          id SERIAL PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL,
          is_big_winner BOOLEAN NOT NULL DEFAULT FALSE,
          UNIQUE(game_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS system_settings (
          key VARCHAR(64) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_games_played_at_id ON games(played_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_game_records_user_id ON game_records(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
      `);
    }

    // 登录/绑定时会清理过期设备，对已有库补一个幂等索引；
    // 同时清理已被 UNIQUE 约束隐式索引覆盖的冗余索引，并升级 games 复合排序索引
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_devices_expires_at ON user_devices(expires_at);
      DROP INDEX IF EXISTS idx_user_devices_token;
      DROP INDEX IF EXISTS idx_game_records_game_id;
      DROP INDEX IF EXISTS idx_games_played_at;
      CREATE INDEX IF NOT EXISTS idx_games_played_at_id ON games(played_at DESC, id DESC);
    `);

    // 用户名大小写不敏感唯一：应用层查重与登录均按 LOWER(username) 口径，
    // 数据库层补幂等唯一索引兜底并发插入；历史数据存在同名冲突时仅告警不阻断启动
    try {
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`,
      );
    } catch (indexErr: unknown) {
      console.warn(
        '⚠️ 用户名大小写唯一索引创建失败（可能存在仅大小写不同的历史账号），请人工核对：',
        indexErr instanceof Error ? indexErr.message : indexErr,
      );
    }

    // 初始化默认房费设置
    const defaultRoomFee = parseInt(process.env.DEFAULT_ROOM_FEE || '100', 10);
    await client.query(
      `INSERT INTO system_settings (key, value)
       VALUES ('default_room_fee', $1)
       ON CONFLICT (key) DO NOTHING`,
      [String(Number.isNaN(defaultRoomFee) ? 100 : defaultRoomFee)],
    );

    // 检查是否存在管理员账号，不存在则自动创建初始管理员
    const adminCheck = await client.query(`SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`);
    if (adminCheck.rowCount === 0) {
      const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
      const adminNickname = (process.env.ADMIN_NICKNAME || '管理员').trim();
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin@123456';
      if (!process.env.ADMIN_PASSWORD) {
        console.warn(
          '⚠️ 未设置 ADMIN_PASSWORD，初始管理员将使用默认密码 admin@123456，请登录后立即修改',
        );
      }
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const bindToken = generateToken(24);

      await client.query(
        `INSERT INTO users (username, nickname, password_hash, role, avatar_color, is_active, bind_token)
         VALUES ($1, $2, $3, 'ADMIN', 'amber', TRUE, $4)
         ON CONFLICT (username) DO UPDATE SET role = 'ADMIN'`,
        [adminUsername, adminNickname, passwordHash, bindToken],
      );
    }

    // 为没有 bind_token 的历史用户补齐 bind_token
    const missingTokenUsers = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE bind_token IS NULL`,
    );
    for (const row of missingTokenUsers.rows) {
      await client.query(`UPDATE users SET bind_token = $1 WHERE id = $2`, [
        generateToken(24),
        row.id,
      ]);
    }

    await client.query('COMMIT');
  } catch (err: unknown) {
    // 连接已断开时 ROLLBACK 本身也会失败，不能让它掩盖原始错误
    await client.query('ROLLBACK').catch(() => undefined);

    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === '42501') {
      console.error(
        '\n============================================================\n' +
          '❌ PostgreSQL 权限不足：当前数据库用户没有 public schema 的建表权限。\n' +
          '请在 PostgreSQL 超级用户 (postgres) 下执行以下授权命令：\n\n' +
          `  \\c ${process.env.DB_NAME || 'big_winner'}\n` +
          `  GRANT ALL ON SCHEMA public TO ${process.env.DB_USER || 'big_winner'};\n` +
          `  -- 或直接移交数据库所有权：\n` +
          `  ALTER DATABASE ${process.env.DB_NAME || 'big_winner'} OWNER TO ${process.env.DB_USER || 'big_winner'};\n` +
          '============================================================\n',
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureDbInitialized(): Promise<void> {
  if (!global.__bigWinnerInitPromise) {
    // 无论失败发生在取连接还是建表阶段，都要清掉缓存，让下一次请求重新初始化，
    // 否则数据库晚于应用启动时失败结果会被永久缓存，只能重启进程恢复
    const promise: Promise<void> = runInitialization().catch((err: unknown) => {
      if (global.__bigWinnerInitPromise === promise) {
        global.__bigWinnerInitPromise = undefined;
      }
      throw err;
    });
    global.__bigWinnerInitPromise = promise;
  }
  return global.__bigWinnerInitPromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  await ensureDbInitialized();
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDbInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // 连接已断开时 ROLLBACK 本身也会失败，不能让它掩盖原始业务错误
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
