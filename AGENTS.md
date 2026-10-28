# AGENTS.md

大赢家（BigWinner）：好友娱乐战绩与房费记账系统。移动端优先（主要在微信内置浏览器使用），全中文 UI，红=赢、绿=输

## 技术栈

- Next.js 15 App Router + React 19 + TypeScript（strict），路径别名 `@/*` → `src/*`
- Tailwind CSS 3、lucide-react
- PostgreSQL：`pg` 直连裸 SQL，无 ORM、无迁移工具
- 测试：Vitest（jsdom 环境）+ Testing Library，测试文件与源码同目录（`*.test.ts(x)`）
- 代码规范：ESLint 9（flat config，`next/core-web-vitals` + `next/typescript`）、Prettier（printWidth 100、单引号、分号）
- pnpm + Node 24；`next.config.mjs` 使用 `output: 'standalone'`，Docker 多阶段构建

## 常用命令

```bash
pnpm dev            # 开发
pnpm build          # 生产构建（会执行 ESLint，lint 不过则构建失败）
pnpm lint           # ESLint 检查（lint:fix 自动修复）
pnpm format         # Prettier 全库格式化（format:check 仅校验）
pnpm test           # Vitest 跑全部测试（test:watch 监听模式）
pnpm typecheck      # tsc --noEmit
docker compose up -d --build   # 生产部署（容器启动时自动幂等建表）
node scripts/test-db-connection.mjs  # 验证 .env 数据库连通性
```

**改动后必须跑 `pnpm lint` + `pnpm typecheck` + `pnpm test`，涉及服务端逻辑再跑 `pnpm build`**；格式统一交给 Prettier（跑 `pnpm format`），不要手写格式化提交

**开发服务器固定使用 3000 端口**：启动 `pnpm dev` 前若 3000 被占用（通常是残留的旧 dev 实例），先杀掉旧进程再启动，不得改用其他端口。清理命令：`kill $(ss -tlnp | grep :3000 | grep -oP 'pid=\K\d+') 2>/dev/null`（本机 WSL2 下 `lsof -i` 与 `fuser` 不可用，勿用）。另外后台运行时用 `tail -f /dev/null | pnpm dev` 保持 stdin 打开，否则 Next.js dev 检测到 stdin 关闭会自动退出

**跑 `pnpm build` 前先停掉 `pnpm dev`**：两者共用 `.next` 目录，dev 运行期间执行生产构建会覆写 dev 正在引用的 webpack chunk，导致页面运行时报 `Cannot find module './xx.js'`。若已发生，杀进程后 `rm -rf .next` 再重启 dev 即可恢复

## 工作原则

- 先读相关代码再动手：改业务规则先看 `src/lib/`，写页面 / API 先参考相邻模块的既有写法；最小修改范围，完成后自检（`pnpm lint` + `pnpm typecheck` + `pnpm test`，涉服务端逻辑再 `pnpm build`）
- 优先复用既有组件与成熟模式（`src/components/`、既有 API 路由与 SQL 写法），避免平行造轮子
- 缺少信息时明确提问，不假设、不编造
- Git 提交消息使用中文，格式 `类型: 描述`（如 `feat:` / `docs:` / `fix:`）

## 目录结构

- `src/lib/` — 核心业务，改任何规则前先读这里：
  - `gameLogic.ts`：记账校验（零和配平、大赢家判定）、周期过滤（Asia/Shanghai 时区）
  - `db.ts`：连接池、`query` / `withTransaction`、启动时幂等建表 DDL
  - `auth.ts`：设备 Token 会话、`getCurrentUser`、Cookie 读写
  - `format.ts`：头像主题、展示格式化
- `src/app/api/` — REST 路由：`auth`（login/logout/me/bind/restore）、`bootstrap`（冷启动聚合）、`games`、`users`、`stats`、`settings`、`health`
- `src/app/` — 页面：首页 `/`、`/games`、`/stats`、`/profile`、`/login`、`/bind`
- `src/components/` — AppShell、GameEditorModal、PlayerAvatar、TrendChart、ConfirmDialog、CopyFallbackModal、Toast
- `src/lib/apiClient.ts` — 客户端取数：GET 短缓存 + 并发去重 + 统一 401 处理

## 业务铁律（不可破坏）

1. **零和配平**：`Σ 玩家本场金额 + 房费 = 0`，否则拒绝写入（`validateAndComputeRecords`）
2. **房费**是台面上的虚拟玩家，恒为整数且 ≥ 0（即“庄家”永远赢）
3. **大赢家 👑**：单场最高分且 > 0，允许多人并列（`is_big_winner`）
4. 所有输赢金额必须为整数，且绝对值不超过 2147483647（PostgreSQL INTEGER 上限）；同一场次同一玩家不可重复
5. **认证体系**：设备 Token（365 天滑动续期），Cookie `bw_device_token` 与 `x-device-token` header 双通道；管理员生成 `bind_token` 供好友免密绑定。登录接口带进程内失败限流（同一「账号+IP」15 分钟内失败 5 次锁定 15 分钟，返回 429），重置玩家密码时同步下线其全部设备。新增 API 一律先 `getCurrentUser()`，未登录返回 401

## 架构约定

- **分层**：SQL（`query` / `withTransaction`）只出现在 `src/app/api/` 路由层；页面与组件一律 `'use client'` 经 `fetch('/api/...')` 取数，不直接导入 `db.ts`；业务校验集中在 `src/lib/`，前端不重复实现
- **数据库**：5 张表（users、user_devices、games、game_records、system_settings），schema 全部定义在 `db.ts` 的启动初始化中（`CREATE TABLE IF NOT EXISTS` + advisory lock 防并发）。改 schema 时必须在此处追加幂等 DDL——注意首次建表 DDL 包在 `if (!tablesExist)` 块内，对已有库新增列/索引的幂等 DDL 必须放在该块之外才会生效，且保证对已有数据向后兼容（本项目无迁移框架）
- **API 响应**：错误统一 `{ error: '中文消息' }` + 对应 HTTP 状态码；成功直接返回 JSON
- **写操作**用 `withTransaction` 包裹；SQL 一律参数化（`$1` 占位），禁止字符串拼接
- **时间**：业务周期（年/月）按 `Asia/Shanghai` 时区计算与过滤，用 `TO_CHAR(... AT TIME ZONE ...)`
- **展示**：页面上用户一律显示 `nickname` 而非 `username`；UI 文案、代码注释均为中文
- **移动端**：所有页面按手机竖屏设计并适配微信浏览器，勿引入桌面优先布局
- 敏感配置只在 `.env`（参考 `.env.example`），不要硬编码或提交真实凭据

## 数据库排查（DBX-MCP）

已配置可用连接时，用于数据级排查（核对真实数据、验证 SQL 口径与查询结果）：

- 只执行只读语句（`SELECT` / `EXPLAIN` 等）；**严禁直接写库改数据或执行 DDL**——schema 由 `db.ts` 幂等 DDL 管理，数据修正必须走应用层校验，绕过写入可能破坏零和配平
- 表结构与业务口径优先看 `db.ts` 的 DDL 定义与 `gameLogic.ts`，DBX 用来核对真实数据
- 当前 `.env` 指向 `192.168.1.11/big_winner`；DBX 无对应连接时回退代码静态分析，勿误连其他项目的库，也不要反复重试

## 禁止事项（未经明确要求）

- 改业务铁律（零和配平、房费规则、大赢家判定）与既有校验逻辑
- 升级依赖、改 Dockerfile / docker-compose.yml
- 改目录结构、重命名文件
- 删除已有功能、重写模块
- 引入未使用依赖、修改无关代码
- 使用 npm / yarn（统一 pnpm，防 lockfile 漂移）
- 无故修改 tsconfig.json、next.config.mjs、tailwind.config.ts 等工程配置
- 在日志或接口响应中输出敏感信息（密码、token）

> **开发期例外**：有建设性的优化需要突破上述限制（大改）时，先向用户说明改动范围与理由，经确认后方可动手；该解除仅对当次任务有效，不延续到后续任务。

## 文档同步

| 变更          | 同步目标                                             |
| ------------- | ---------------------------------------------------- |
| 数据库表      | `src/lib/db.ts` 启动 DDL（幂等、向后兼容）           |
| 环境变量/配置 | `.env.example`、`src/lib/db.ts` 默认值               |
| 业务规则/API  | `README.md` 对应小节、本文件「业务铁律」「架构约定」 |

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
- **等宽数字**：金额、统计数值、走势图数值等纯数字展示加 `tabular-nums`，列表/表格中数字对齐更整齐
- **文案精炼**：UI 文案删冗余修饰词，不加非必要说明文字
