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
          -- 自定义头像图片（base64 data URL，NULL = 未设置，落字母主题色头像；前端压缩后应用层限长）
          avatar_image TEXT,
          -- 头像版本号：写头像（设置/清除）时 +1，客户端按它判断本地缓存是否失效
          avatar_version INTEGER NOT NULL DEFAULT 0,
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

        -- 免登录分享链接：/s/{code}，管理员创建，好友群内免登录查看指定时间段数据
        CREATE TABLE IF NOT EXISTS share_links (
          id SERIAL PRIMARY KEY,
          -- 分享码 generateToken(8) → 16 hex；明文存储（同 bind_token 先例），便于管理员再次复制链接
          code VARCHAR(32) UNIQUE NOT NULL,
          -- 逗号分隔的内容模块：board（总榜）/ games（流水）/ stats（看板）
          content_scope VARCHAR(32) NOT NULL,
          -- 'period' = 周期（period 列）；'range' = 自定义起止日期（range_start/range_end 列）
          period_type VARCHAR(16) NOT NULL,
          -- period_type=period 时：'all' | 'YYYY' | 'YYYY-MM'（创建时已固化为具体年/月，不随后时间漂移）
          period VARCHAR(8) NOT NULL DEFAULT 'all',
          -- period_type=range 时的起止日期（上海时区自然日，range_end 含当天）
          range_start DATE,
          range_end DATE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          -- 过期时间，NULL = 永久有效
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    // 免登录分享链接表（老库演进：与上方首次建表 DDL 保持一致的幂等写法）。
    // 查询仅按 code 唯一索引命中，无按过期时间检索的场景，
    // idx_share_links_expires_at 为审查后移除的冗余索引，这里幂等清理已建库
    await client.query(`
      CREATE TABLE IF NOT EXISTS share_links (
        id SERIAL PRIMARY KEY,
        code VARCHAR(32) UNIQUE NOT NULL,
        content_scope VARCHAR(32) NOT NULL,
        period_type VARCHAR(16) NOT NULL,
        period VARCHAR(8) NOT NULL DEFAULT 'all',
        range_start DATE,
        range_end DATE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      DROP INDEX IF EXISTS idx_share_links_expires_at;
    `);

    // 自定义头像图片列（老库演进）：base64 data URL，NULL = 未设置；长度由应用层校验
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image TEXT;`);
    // 头像版本号列（老库演进）：客户端本地缓存失效判断依据
    await client.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_version INTEGER NOT NULL DEFAULT 0;`,
    );

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

    // 初始化玩家密码登录开关（默认关闭：普通玩家只能通过管理员分享的免登链接访问）
    await client.query(
      `INSERT INTO system_settings (key, value)
       VALUES ('password_login_enabled', 'false')
       ON CONFLICT (key) DO NOTHING`,
    );

    // HTTPS 部署需显式开启 Cookie Secure 标志，否则会话 Cookie 可经明文链路传输；
    // 纯 HTTP 内网部署可忽略此提醒
    if (process.env.NODE_ENV === 'production' && !process.env.COOKIE_SECURE) {
      console.warn(
        '⚠️ 未设置 COOKIE_SECURE=true：HTTPS 部署请配置以启用 Cookie Secure 标志；纯 HTTP 内网部署可忽略',
      );
    }

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

    // 开发调试管理员（仅非生产环境生效）：.env 配置 DEV_ADMIN_USERNAME / DEV_ADMIN_PASSWORD 时，
    // 确保对应管理员账号存在且密码同步，便于本地开发调试；生产环境（NODE_ENV=production）一律忽略。
    // 同名真实玩家账号不改动，避免误提升/重置
    if (process.env.NODE_ENV !== 'production') {
      const devUsername = (process.env.DEV_ADMIN_USERNAME || '').trim();
      const devPassword = process.env.DEV_ADMIN_PASSWORD || '';
      if (devUsername && devPassword) {
        const devHash = await bcrypt.hash(devPassword, 10);
        const existingRes = await client.query<{ role: string }>(
          `SELECT role FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          [devUsername],
        );
        if (existingRes.rowCount === 0) {
          await client.query(
            `INSERT INTO users (username, nickname, password_hash, role, avatar_color, is_active, bind_token)
             VALUES ($1, $2, $3, 'ADMIN', 'amber', TRUE, $4)`,
            [devUsername, '开发调试', devHash, generateToken(24)],
          );
          console.warn(`🔧 开发调试管理员已创建：${devUsername}（仅非生产环境生效）`);
        } else if (existingRes.rows[0].role === 'ADMIN') {
          await client.query(
            `UPDATE users SET password_hash = $2, is_active = TRUE WHERE LOWER(username) = LOWER($1)`,
            [devUsername, devHash],
          );
          console.warn(`🔧 开发调试管理员密码已同步：${devUsername}（仅非生产环境生效）`);
        } else {
          console.warn(
            `⚠️ 已存在同名玩家账号 ${devUsername}，跳过开发调试管理员配置（请更换 DEV_ADMIN_USERNAME）`,
          );
        }
      }
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
