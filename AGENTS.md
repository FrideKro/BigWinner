# AGENTS.md

大赢家（BigWinner）：熟人麻将输赢战绩与房费记账系统。移动端优先（主要在微信内置浏览器使用），全中文 UI，红=赢、绿=输

## 技术栈

- Next.js 15 App Router + React 19 + TypeScript（strict），路径别名 `@/*` → `src/*`
- Tailwind CSS 3、lucide-react
- PostgreSQL：`pg` 直连裸 SQL，无 ORM、无迁移工具
- pnpm + Node 24；`next.config.mjs` 使用 `output: 'standalone'`，Docker 多阶段构建

## 常用命令

```bash
pnpm dev            # 开发
pnpm build          # 生产构建
pnpm typecheck      # tsc --noEmit
docker compose up -d --build   # 生产部署（容器启动时自动幂等建表）
node scripts/test-db-connection.mjs  # 验证 .env 数据库连通性
```

无 ESLint、Prettier、测试框架。**改动后必须跑 `pnpm typecheck`，涉及服务端逻辑再跑 `pnpm build`**

## 目录结构

- `src/lib/` — 核心业务，改任何规则前先读这里：
  - `gameLogic.ts`：记账校验（零和配平、大赢家判定）、周期过滤（Asia/Shanghai 时区）
  - `db.ts`：连接池、`query` / `withTransaction`、启动时幂等建表 DDL
  - `auth.ts`：设备 Token 会话、`getCurrentUser`、Cookie 读写
  - `format.ts`：头像主题、展示格式化
- `src/app/api/` — REST 路由：`auth`（login/logout/me/bind/restore）、`games`、`users`、`stats`、`settings`、`health`
- `src/app/` — 页面：首页 `/`、`/games`、`/stats`、`/profile`、`/login`、`/bind`
- `src/components/` — AppShell、GameEditorModal、PlayerAvatar、TrendChart

## 业务铁律（不可破坏）

1. **零和配平**：`Σ 玩家本场金额 + 房费 = 0`，否则拒绝写入（`validateAndComputeRecords`）
2. **房费**是台面上的虚拟玩家，恒为整数且 ≥ 0（即“庄家”永远赢）
3. **大赢家 👑**：单场最高分且 > 0，允许多人并列（`is_big_winner`）
4. 所有输赢金额必须为整数；同一场次同一玩家不可重复
5. **认证体系**：设备 Token（365 天滑动续期），Cookie `bw_device_token` 与 `x-device-token` header 双通道；管理员生成 `bind_token` 供好友免密绑定。新增 API 一律先 `getCurrentUser()`，未登录返回 401

## 架构约定

- **数据库**：5 张表（users、user_devices、games、game_records、system_settings），schema 全部定义在 `db.ts` 的启动初始化中（`CREATE TABLE IF NOT EXISTS` + advisory lock 防并发）。改 schema 时必须在此处追加幂等 DDL，且保证对已有数据向后兼容（本项目无迁移框架）
- **API 响应**：错误统一 `{ error: '中文消息' }` + 对应 HTTP 状态码；成功直接返回 JSON
- **写操作**用 `withTransaction` 包裹；SQL 一律参数化（`$1` 占位），禁止字符串拼接
- **时间**：业务周期（年/月）按 `Asia/Shanghai` 时区计算与过滤，用 `TO_CHAR(... AT TIME ZONE ...)`
- **展示**：页面上用户一律显示 `nickname` 而非 `username`；UI 文案、代码注释均为中文
- **移动端**：所有页面按手机竖屏设计并适配微信浏览器，勿引入桌面优先布局
- 敏感配置只在 `.env`（参考 `.env.example`），不要硬编码或提交真实凭据
