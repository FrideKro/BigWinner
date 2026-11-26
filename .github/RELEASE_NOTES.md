<!--
发版说明：每次打 tag 前更新本文件并提交，CI 的 release job 读取它作为 Release 正文。
以下为 v1.5.2 发版说明（覆盖 v1.5.1 之后至当前 HEAD 的变更）。
-->

## ⚠️ 升级注意

- **反向代理需显式开启 `TRUST_PROXY`**：应用默认不再信任客户端上报的 `X-Forwarded-For`；如经单层 Nginx/Caddy 反向代理部署，请在 `.env` 中配置 `TRUST_PROXY=true` 并由代理覆写 `X-Forwarded-For`（直连部署保持默认 `false`）
- **管理员会话与免登链接收紧**：管理员会话强制仅走 `HttpOnly` Cookie（不再写入 `localStorage` 或支持本地恢复），并禁用管理员微信免登链接；升级后原有在微信端仅靠免登链接保持的管理员会话需重新用账号密码登录

## 🛠 修复

- **认证与凭证安全加固**：
  - 管理员登录、`/api/bootstrap` 与 `/api/auth/me` 不再下发明文 `deviceToken`，`/api/auth/restore` 与前端自动清理管理员本地凭证
  - `/api/auth/bind` 拒绝管理员绑定，玩家列表与管理接口不再下发管理员 `bindToken`；免登链接改用 URL Hash（`/bind#token=...`）传参并在读取后立即抹除地址栏
  - 改密接口原密码校验新增进程内失败限流（5 次失败锁定 15 分钟）；登录多账号喷洒按纯 IP 限流且单次合法登录不再重置纯 IP 计数
  - 修复限流窗口末尾锁定后越过原窗口期被提前重置的问题，限流状态容器改挂 `globalThis`
- **输入校验与运行可靠性**：
  - 请求体改用流式读取并在超出 1MB 时立即截断，拒绝非纯对象 JSON；认证接口默认注入 `Cache-Control: private, no-store`
  - 头像校验新增 base64 格式与 JPEG/PNG/WebP 文件头魔数检查；随机密码生成改用 `crypto.randomInt` 消除取模偏差
  - 生产构建移除 CSP `unsafe-eval`；`DB_SSLMODE=verify-ca` 正确启用证书校验；数据库连接池增加 10s `statement_timeout`；启动建表唯一索引改用 `SAVEPOINT` 容错，避免失败引发事务中止导致全站 500
- **分享、越权与流水线收口**：
  - `/api/s/[code]` 看板校验 `userId` 必须属于对外可见榜单，且仅按可见榜单查询头像
  - 首页「分享战报」按钮与弹窗仅对管理员展示；降级或停用最后一位管理员时统一按 `is_active = TRUE` 口径拦截
  - GitHub Actions 第三方 Action 固定为不可变 commit SHA

## ♻️ 优化

- **头像批量同步与缓存**：新增 `GET /api/users/avatars`（单次最多 50 位玩家）替代冷启动 N 次并发单人请求；单人头像 `?v=` 命中时返回长效不可变私有缓存；分享页同页切换 Tab/玩家支持跳过重复头像传输
- **看板与流水按需查询**：`/api/stats` 支持 `scope=personal` / `scope=roomFee` 与 `onlyPersonal=1`，同周期切换玩家不再重查全库榜单与连胜；`/api/games` 仅首页统计全库总场次/总房费且到达翻页上限停止；连胜窗口函数前先过滤临时玩家
- **数据库与前端渲染性能**：设备 Token 滑动续期在查询阶段判断是否需要续期，常态请求由 2 次 DB 往返降为 1 次；`system_settings` 合并单条 SQL 并缓存 60s；新增覆盖索引 `idx_game_records_user_game_cover` 替代旧单列索引；`TrendChart` 几何计算缓存且拖动未变点位不重渲染
