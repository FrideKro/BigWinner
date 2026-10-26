# 大赢家 (BigWinner) 🀄

熟人麻将输赢战绩与房费记账系统。专为手机端（微信内置浏览器）设计，采用红赢绿输视觉、零和智能配平与战报一键分享

## 核心设计与特性

1. **零和配平与“房费机器人”铁律**
   - 房费作为台面上的固定虚拟玩家（始终赢，房费 ≥ 0），满足：
     `Σ 各玩家本场净输赢 + 本场房费 = 0`
   - 默认 4 人上桌，支持 2~N 人动态增减；支持一键反算房费或自动配平最后一名玩家
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
