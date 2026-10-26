import pg from 'pg';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');

const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    env[k] = v;
  }
}

const pool = new pg.Pool({
  host: env.DB_HOST,
  port: parseInt(env.DB_PORT || '5432', 10),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: env.DB_SSLMODE === 'disable' ? false : undefined,
  connectionTimeoutMillis: 5000,
});

async function main() {
  console.log(`Connecting to Postgres at ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}...`);
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW() AS current_time, version()');
    console.log('✅ 数据库连接成功！');
    console.log('当前数据库时间:', res.rows[0].current_time);
    console.log('版本信息:', res.rows[0].version.slice(0, 60));
    client.release();
    await pool.end();
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  }
}

main();
