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
    const err = error as { message?: string };
    return NextResponse.json(
      { status: 'DOWN', database: 'ERROR', error: err.message },
      { status: 503 },
    );
  }
}
