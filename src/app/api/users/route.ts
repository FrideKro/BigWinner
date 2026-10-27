import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, generateToken } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const isAdmin = currentUser.role === 'ADMIN';

    const res = await query<{
      id: number;
      username: string;
      nickname: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
      bind_token: string | null;
      created_at: string;
      device_count: string;
    }>(
      `SELECT u.id,
              u.username,
              u.nickname,
              u.role,
              u.avatar_color,
              u.is_active,
              u.bind_token,
              u.created_at,
              COUNT(ud.id) FILTER (WHERE ud.expires_at > NOW())::text AS device_count
       FROM users u
       LEFT JOIN user_devices ud ON ud.user_id = u.id
       GROUP BY u.id
       ORDER BY u.is_active DESC, u.id ASC`,
    );

    return NextResponse.json({
      users: res.rows.map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        role: u.role,
        avatarColor: u.avatar_color,
        isActive: u.is_active,
        bindToken: isAdmin ? u.bind_token : undefined,
        deviceCount: isAdmin ? parseInt(u.device_count || '0', 10) : undefined,
        createdAt: u.created_at,
      })),
    });
  } catch (error) {
    console.error('List users error:', error);
    return NextResponse.json({ error: '获取玩家列表失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: '仅管理员可创建玩家账号' }, { status: 403 });
    }

    const body = await req.json();
    const username = String(body.username || '').trim();
    const nickname = String(body.nickname || '').trim();
    const password = String(body.password || '123456');
    const role = body.role === 'ADMIN' ? 'ADMIN' : 'PLAYER';
    const avatarColor = String(body.avatarColor || 'red').trim();
    const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;

    if (!username || !nickname) {
      return NextResponse.json({ error: '登录账号和显示昵称不能为空' }, { status: 400 });
    }

    if (password.length < 4) {
      return NextResponse.json({ error: '初始密码长度至少为 4 位' }, { status: 400 });
    }

    const existing = await query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [
      username,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      return NextResponse.json({ error: `登录账号 "${username}" 已存在` }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const bindToken = generateToken(24);

    const insertRes = await query<{
      id: number;
      username: string;
      nickname: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
      bind_token: string;
      created_at: string;
    }>(
      `INSERT INTO users (username, nickname, password_hash, role, avatar_color, is_active, bind_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, nickname, role, avatar_color, is_active, bind_token, created_at`,
      [username, nickname, passwordHash, role, avatarColor, isActive, bindToken],
    );

    const u = insertRes.rows[0];
    return NextResponse.json(
      {
        user: {
          id: u.id,
          username: u.username,
          nickname: u.nickname,
          role: u.role,
          avatarColor: u.avatar_color,
          isActive: u.is_active,
          bindToken: u.bind_token,
          deviceCount: 0,
          createdAt: u.created_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: '创建玩家账号失败' }, { status: 500 });
  }
}
