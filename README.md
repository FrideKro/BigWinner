# 大赢家 (BigWinner) 🏆

好友娱乐战绩与房费记账。专为手机端（微信内置浏览器）设计，采用红赢绿输视觉、零和智能配平与战报一键分享

## 核心设计与特性

1. **零和配平与“房费机器人”铁律**
   - 房费作为台面上的固定虚拟玩家（始终赢，房费 ≥ 0），满足：
     `Σ 各玩家本场净输赢 + 本场房费 = 0`
   - 默认 4 人开局，支持 2~N 人动态增减；支持一键反算房费或自动配平最后一名玩家
2. **“当场大赢家”👑 判定**
   - 单场得分最高且 > 0 者自动荣膺👑大赢家称号，支持多人并列最高
3. **微信端长效免密登录体系**
   - 数据库记录设备 Token，Cookie + LocalStorage 双保险，每次访问自动滑动续期 365 天
   - 管理员可在后台一键复制朋友的**「微信免登激活链接」**私发好友，点开一次直接绑定本机微信，此后点群内任何战报链接皆自动免密登录
4. **群战报一键复制**
   - 单场战绩与排行榜均支持一键复制带 Emoji 的微信群文案与网页访问链接
5. **多维统计与资金走势**
   - 个人累计盈亏走势平滑折线图、巅峰局/至暗局极值记录、当前连胜连败状态与月度房费汇总

## 快速启动 (Docker)

项目基于 **Node.js 24 (node:24.21-trixie-slim)** 与 **pnpm**，通过多阶段构建输出 Next.js Standalone 生产环境容器

### 1. 本地开发 (可选)

```bash
pnpm install
pnpm dev
```

### 2. 配置环境变量

确保根目录存在 `.env`（可参考 `.env.example`）：

```dotenv
DB_HOST=192.168.1.11
DB_PORT=5432
DB_NAME=big_winner
DB_USER=big_winner
DB_PASSWORD=your_password
DB_SSLMODE=disable

ADMIN_USERNAME=admin
ADMIN_NICKNAME=群主管理员
ADMIN_PASSWORD=admin123
DEFAULT_ROOM_FEE=100
PORT=3000
```

### 3. 构建与运行

```bash
docker compose up -d --build
```

容器启动时会自动连接 PostgreSQL 执行幂等建表与管理员初始化，无需手动执行数据库脚本

访问地址：`http://服务器IP:3000`

- 初始管理员账号：`admin`
- 初始密码：`admin123`（或你设置的 `ADMIN_PASSWORD`）

## CI/CD

仓库使用 GitHub Actions（`.github/workflows/`）：

- **CI**：PR 与 push `main` 时执行格式检查、ESLint、类型检查、单元测试与生产构建；push `v*` tag 时额外构建并推送镜像到 GHCR，并自动创建 GitHub Release
- **Deploy Prod**：可选，仅仓库所有者使用；手动触发，通过 SSH 部署到自己的服务器

### 发版

```bash
git tag v1.2.3
git push origin v1.2.3
```

CI 会构建并推送 `ghcr.io/<owner>/<repo>` 的 `1.2.3`、`1.2`、`latest` 三个 tag，并创建 Release。无需配置 registry 凭据，使用仓库内置 `GITHUB_TOKEN`。

镜像默认只构建 `linux/amd64`。生产机是 ARM（如部分 VPS/NAS）时，在仓库 Settings → Variables 添加 `BUILD_PLATFORMS=linux/amd64,linux/arm64`，CI 会启用 QEMU 模拟构建（耗时明显增加）。

### 部署（可选）

生产机准备：

1. 安装 docker 与 compose 插件
2. 创建 `/opt/big-winner/.env`（数据库配置，参考 `.env.example`）
3. 在仓库 Secrets 配置 `PROD_HOST` / `PROD_SSH_PRIVATE_KEY` / `PROD_SSH_HOST_KEY`（可选 `PROD_SSH_USER` / `PROD_SSH_PORT` / `PROD_COMPOSE_DIR`）
4. Actions → Deploy Prod → Run workflow（job 绑定 `production` environment，可在 Settings → Environments 配置必需审批人）

GHCR 包默认 private：deploy workflow 会用 `GITHUB_TOKEN` 在生产机登录后拉取；也可在仓库 Packages 设置把包改为 public，生产机即可匿名拉取。登录凭据会写入生产机默认 docker 配置（可能覆盖同机其他项目的 GHCR 登录；token 随 job 结束失效）。

也可在生产机手动执行 `bash deploy-prod.sh`：本地镜像（`localhost/*`）自动跳过拉取，`IMAGE_NAME` / `IMAGE_TAG` 可写在 `.env` 或作为环境变量传入。

> 生产机 `.env` 不会被 workflow 覆盖；本地开发仍可直接 `docker compose up -d --build`。

> 已有部署迁移：compose 项目名按目录推导，且容器名固定为 `big_winner_app`。若旧部署从其他目录启动，先在旧目录执行 `docker compose down`，否则新目录首次部署会因容器名冲突失败。

### 依赖更新

Dependabot 每周检查 npm、Docker 与 GitHub Actions 依赖并提交 PR（`.github/dependabot.yml`）。
