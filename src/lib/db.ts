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
    global.__bigWinnerPool = createPool();
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

        CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at DESC);
        CREATE INDEX IF NOT EXISTS idx_game_records_game_id ON game_records(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_records_user_id ON game_records(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_devices_token ON user_devices(device_token);
        CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
      `);
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
      const adminNickname = (process.env.ADMIN_NICKNAME || '群主管理员').trim();
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
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
    await client.query('ROLLBACK');
    global.__bigWinnerInitPromise = undefined;

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
    global.__bigWinnerInitPromise = runInitialization();
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
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
