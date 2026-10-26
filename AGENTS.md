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

**开发服务器固定使用 3000 端口**：启动 `pnpm dev` 前若 3000 被占用（通常是残留的旧 dev 实例），先杀掉旧进程再启动，不得改用其他端口。清理命令：`kill $(ss -tlnp | grep :3000 | grep -oP 'pid=\K\d+') 2>/dev/null`（本机 WSL2 下 `lsof -i` 与 `fuser` 不可用，勿用）。另外后台运行时用 `tail -f /dev/null | pnpm dev` 保持 stdin 打开，否则 Next.js dev 检测到 stdin 关闭会自动退出

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

## UI 样式规范

- **字号**（内容以中文为主，宁大勿小）：
  - 正文可读内容（说明文字、消息提示、表单 label、按钮文字）≥ 14px（`text-sm`）
  - 核心内容（玩家昵称、关键金额）用 16px（`text-base`）；所有输入框一律 `text-base`（同时避免 iOS/微信聚焦时自动放大页面）
  - 徽章、单位、时间戳、底部导航等短辅助元素最低 12px（`text-xs`）
  - 全站禁止 12px 以下字号，禁用 `text-[9px]`/`text-[10px]`/`text-[11px]` 之类自定义小字号；唯一例外：TrendChart 的 SVG 坐标轴刻度可用 `text-[11px]`（纯数字/日期）
- **字重**（中文粗体易发糊，尽量不用）：
  - 中文文本（标题、昵称、label、按钮、徽章、提示条）一律 ≤ `font-medium`，禁用 `font-bold`/`font-semibold`/`font-black`
  - 纯数字内容可保留粗体强调：金额用 `font-black`，统计数值（胜率、场次等）可用 `font-bold`；数字输入框可用 `font-semibold`
  - 选中/高亮状态靠底色、阴影、颜色区分，不靠加粗
