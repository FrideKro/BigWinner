import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, type AuthUser } from '@/lib/auth';

// 携带 HTTP 状态码的业务错误，事务内提前失败后由 withAuth 转换为对应 4xx 响应
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AuthedHandler<P extends Record<string, string>> = (
  req: NextRequest,
  user: AuthUser,
  context: { params: Promise<P> },
) => Promise<NextResponse>;

interface WithAuthOptions {
  /** 提供时要求管理员身份，值为 403 响应文案 */
  admin?: string;
  /** 500 响应文案，同时用作服务端错误日志前缀 */
  error?: string;
}

// 解析 JSON 请求体；非法 JSON 统一 400，而不是落入外层 500
export async function parseJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, '请求体格式无效');
  }
}

// 统一路由样板：登录校验 → 管理员校验 → 业务执行 → ApiError / 异常转换。
// 500 文案兼任错误日志前缀，使各路由的日志与响应保持一致可区分
export function withAuth<P extends Record<string, string> = Record<string, never>>(
  handler: AuthedHandler<P>,
  options: WithAuthOptions = {},
): (req: NextRequest, context: { params: Promise<P> }) => Promise<NextResponse> {
  const errorLabel = options.error || '请求处理失败';
  return async (req, context) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: '未登录' }, { status: 401 });
      }
      if (options.admin && user.role !== 'ADMIN') {
        return NextResponse.json({ error: options.admin }, { status: 403 });
      }
      const params = (context?.params ?? Promise.resolve({})) as Promise<P>;
      return await handler(req, user, { params });
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error(`${errorLabel}:`, error);
      return NextResponse.json({ error: errorLabel }, { status: 500 });
    }
  };
}
