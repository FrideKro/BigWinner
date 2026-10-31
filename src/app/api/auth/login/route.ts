import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createDeviceSession, setDeviceCookie } from '@/lib/auth';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from '@/lib/profileValidation';
import { clearFailures, getClientIp, getRateLimitState, recordFailure } from '@/lib/rateLimit';
import { ApiError, parseJsonBody } from '../../_lib/handler';
import { getPasswordLoginEnabled } from '../../_lib/shared';

// 公开配置：登录页据此决定是否展示密码表单（关闭时仅管理员可展开登录）
export async function GET() {
  try {
    return NextResponse.json({ passwordLoginEnabled: await getPasswordLoginEnabled() });
  } catch (error) {
    console.error('Login config error:', error);
    return NextResponse.json({ error: '获取登录配置失败' }, { status: 500 });
  }
}

// 预生成的随机串哈希：账号不存在时也执行一次同代价的 bcrypt 比对，
// 抹平「存在/不存在」之间的响应时间差，防用户名枚举计时侧信道
const DUMMY_PASSWORD_HASH = '$2a$10$fcwlKdp9e4OUb8LEXZae9.V0SlY9ejPWirrQ33Jh1nKD4VIxoc7fq';

// 纯 IP 失败阈值：拦截同机多账号密码喷洒（账号+IP 与账号全局键均拦不住跨账号轮换）。
// 阈值放宽到 30 次，避免 NAT 下多家庭成员共享 IP 时被无关失败误伤
const LOGIN_IP_MAX_FAILURES = 30;

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }

    // 三键限流：账号+IP（5 次）+ 账号全局（10 次）防伪造 x-forwarded-for 轮换绕过，
    // 纯 IP（30 次）拦截同机多账号密码喷洒。无反向代理时 getClientIp 为空，
    // 纯 IP 键跳过，前两条键退化为按账号生效（同 bind/restore 口径）
    const normalized = username.toLowerCase();
    const clientIp = getClientIp(req.headers);
    const ipKey = `login:ip:${normalized}:${clientIp}`;
    const userKey = `login:user:${normalized}`;
    const ipOnlyKey = clientIp ? `login:ipmap:${clientIp}` : null;
    const limitState =
      [ipKey, userKey, ...(ipOnlyKey ? [ipOnlyKey] : [])]
        .map((key) => getRateLimitState(key))
        .find((state) => state.locked) ?? null;
    if (limitState) {
      const minutes = Math.max(1, Math.ceil(limitState.retryAfterSeconds / 60));
      return NextResponse.json(
        { error: `尝试次数过多，账号已临时锁定，请约 ${minutes} 分钟后再试` },
        { status: 429 },
      );
    }

    // 失败/成功时三键统一记账与清零
    const recordAllFailures = () => {
      recordFailure(ipKey, 5);
      recordFailure(userKey, 10);
      if (ipOnlyKey) recordFailure(ipOnlyKey, LOGIN_IP_MAX_FAILURES);
    };
    const clearAllFailures = () => {
      clearFailures(ipKey);
      clearFailures(userKey);
      if (ipOnlyKey) clearFailures(ipOnlyKey);
    };

    // 超长账号或密码不进数据库与 bcrypt，直接计入失败并返回 401，防超大字符串 CPU DoS
    if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      recordAllFailures();
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const userRes = await query<{
      id: number;
      username: string;
      nickname: string;
      password_hash: string;
      role: 'ADMIN' | 'PLAYER';
      avatar_color: string;
      is_active: boolean;
    }>(
      `SELECT id, username, nickname, password_hash, role, avatar_color, is_active
       FROM users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [username],
    );

    if (userRes.rowCount === 0) {
      // 与存在账号的失败路径保持同代价耗时，避免计时暴露账号是否存在
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      recordAllFailures();
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordAllFailures();
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: '该账号已停用，请联系管理员' }, { status: 401 });
    }

    // 密码登录开关仅约束普通玩家；管理员始终保留密码登录，避免关闭后无人可管理。
    // 校验放在密码验证之后，未持有正确密码时仍只返回通用错误，不暴露开关与账号角色
    if (user.role !== 'ADMIN' && !(await getPasswordLoginEnabled())) {
      return NextResponse.json(
        { error: '密码登录已关闭，请使用管理员分享的免密登录链接' },
        { status: 403 },
      );
    }

    clearAllFailures();

    const userAgent = req.headers.get('user-agent') || '';
    const deviceToken = await createDeviceSession(user.id, userAgent);

    const res = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarColor: user.avatar_color,
        isActive: user.is_active,
      },
      deviceToken,
    });

    setDeviceCookie(res, deviceToken);
    return res;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
