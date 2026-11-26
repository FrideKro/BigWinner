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

// 请求体大小上限：合法业务请求（含 32KB 内的 base64 头像）远小于该值，
// 防伪造超大 body 造成内存/CPU 压力
const MAX_BODY_BYTES = 1024 * 1024;

// 流式读取请求体并在累计字节超出上限时立即 cancel() 截断，防 chunked 超大包耗尽内存
async function readRequestTextLimited(req: NextRequest): Promise<string> {
  if (req.body && typeof req.body.getReader === 'function') {
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new ApiError(413, '请求体过大');
          }
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
      return text;
    } finally {
      reader.releaseLock();
    }
  }

  // 测试环境或非流式 Request mock 的回退路径
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError(413, '请求体过大');
  }
  return text;
}

// 解析 JSON 请求体；非法 JSON 或非纯对象统一 400、超大 body 统一 413，而不是落入外层 500
export async function parseJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  // Content-Length 头预检：超大请求在读取前即拒绝
  const contentLength = parseInt(req.headers.get('content-length') || '', 10);
  if (Number.isInteger(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ApiError(413, '请求体过大');
  }
  const text = await readRequestTextLimited(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, '请求体格式无效');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, '请求体格式无效');
  }
  return parsed as Record<string, unknown>;
}

// 统一路由样板：登录校验 → 管理员校验 → 业务执行 → 注入默认禁缓存头 → ApiError / 异常转换。
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
      const res = await handler(req, user, { params });
      if (!res.headers.has('Cache-Control')) {
        res.headers.set('Cache-Control', 'private, no-store');
      }
      return res;
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error(`${errorLabel}:`, error);
      return NextResponse.json({ error: errorLabel }, { status: 500 });
    }
  };
}
