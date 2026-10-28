import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const res = await query('SELECT 1 AS healthy');
    if (res.rows[0]?.healthy === 1) {
      return NextResponse.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        database: 'CONNECTED',
      });
    }
    return NextResponse.json({ status: 'DOWN', database: 'UNEXPECTED_RESULT' }, { status: 503 });
  } catch (error: unknown) {
    // 错误详情仅进服务端日志，避免向未认证调用者暴露数据库地址等内部信息
    console.error('Health check failed:', error);
    return NextResponse.json({ status: 'DOWN', database: 'ERROR' }, { status: 503 });
  }
}
