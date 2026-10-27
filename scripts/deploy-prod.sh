#!/usr/bin/env bash
# =============================================================================
# 大赢家 生产部署脚本
#
# 位置：/opt/big-winner/deploy-prod.sh（由 CI Deploy Prod 从仓库分发覆盖，
#       本地亦可直接执行同一脚本：本地镜像 localhost/* 会自动跳过拉取）
#
# 用法：
#   bash deploy-prod.sh                                              # 部署 latest
#   IMAGE_TAG=1.2.3 bash deploy-prod.sh                              # 部署指定版本
#   IMAGE_NAME=ghcr.io/owner/repo IMAGE_TAG=1.2.3 bash deploy-prod.sh
#   也可把 IMAGE_NAME / IMAGE_TAG 写进同目录 .env（shell 环境变量优先）
#
# 镜像来源：
#   - 默认 localhost/big-winner:latest（本地 docker compose build 产物，不拉取）
#   - 生产由 deploy workflow 注入 IMAGE_NAME=ghcr.io/<owner>/<repo>
#   - GHCR private 包需先 docker login ghcr.io（deploy workflow 已自动完成）
#
# 说明：
#   - 只做「拉镜像 + 重启 + 健康检查 + 失败回滚」，不修改 .env
#   - 前置校验 .env 数据库必填项，缺失时立即失败，
#     避免容器启动后才报错、把配置问题误判为应用故障
#   - 升级前记录运行中容器的镜像 ID；启动命令失败或健康检查失败时，
#     按该 ID 打本地备份 tag 自动回滚（不能按 latest 回滚：pull 之后 latest 已指向新镜像）
#   - 首次部署失败时停止崩溃循环的容器；部署成功后清理历史 rollback-* 镜像（保留最近 3 个）
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "!!! 未找到 .env（$PWD/.env）"
  echo "    请先按 README「CI/CD → 部署」准备数据库连接配置"
  exit 1
fi

# .env 必填项校验：compose 插值缺值会静默变成空字符串，容器启动后才暴露
missing=""
for key in DB_HOST DB_NAME DB_USER DB_PASSWORD; do
  if ! grep -qE "^${key}=.+" .env; then
    missing="$missing $key"
  fi
done
if [ -n "$missing" ]; then
  echo "!!! .env 缺少必填项:$missing"
  exit 1
fi

# 取值优先级：shell 环境变量 > .env（sed 解析，不 source 整个文件，避免密码特殊字符被 shell 展开）
env_value() {
  sed -n "s/^$1=//p" .env | tail -1
}
export IMAGE_NAME="${IMAGE_NAME:-$(env_value IMAGE_NAME)}"
IMAGE_NAME="${IMAGE_NAME:-localhost/big-winner}"
export IMAGE_TAG="${IMAGE_TAG:-$(env_value IMAGE_TAG)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# localhost/* 是本地构建产物，没有远端 registry；且 pull 默认 policy=always，
# 即使本地已有镜像也会访问 registry 并失败，因此仅对远端镜像执行拉取
if [[ "$IMAGE_NAME" == localhost/* ]]; then
  echo ">>> 本地镜像 $IMAGE_NAME:$IMAGE_TAG，跳过拉取"
else
  echo ">>> 拉取镜像 $IMAGE_NAME:$IMAGE_TAG"
  docker compose pull app
fi

# 回滚支持：部署前记录运行中容器的镜像 ID（不可变标识）
PREV_IMAGE_ID=""
if docker inspect big_winner_app >/dev/null 2>&1; then
  PREV_IMAGE_ID="$(docker inspect --format '{{.Image}}' big_winner_app)"
fi

wait_healthy() {
  local name=$1 tries=${2:-60} st cst
  for _ in $(seq 1 "$tries"); do
    # 容器已退出（如启动即崩溃）时 healthcheck 停留在 starting 不再更新，快速失败避免空等满程
    cst=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || echo missing)
    case "$cst" in
      missing|exited|dead)
        echo "!!! $name 容器已退出（状态: $cst），健康检查提前失败"
        return 1 ;;
    esac
    st=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo starting)
    [ "$st" = "healthy" ] && return 0
    [ "$st" = "unhealthy" ] && return 1
    sleep 2
  done
  echo "!!! $name 未在 ${tries} 次探测内变 healthy（当前状态: $st，总等待约 $((tries * 2)) 秒）"
  return 1
}

# 部署失败回滚：优先恢复部署前镜像；首次部署无镜像可回滚时停止失败容器
rollback() {
  docker compose logs --tail 80 app || true
  if [ -z "$PREV_IMAGE_ID" ]; then
    echo "!!! 首次部署失败，无部署前镜像可回滚；停止失败容器，请人工介入"
    docker compose stop app || true
    return 0
  fi
  local backup_tag
  backup_tag="rollback-$(date +%Y%m%d%H%M%S)"
  echo ">>> 回滚到部署前镜像 ${PREV_IMAGE_ID#sha256:}（本地 tag: $backup_tag）"
  if ! docker tag "$PREV_IMAGE_ID" "$IMAGE_NAME:$backup_tag"; then
    echo "!!! 部署前镜像打标签失败，请人工介入"
    return 0
  fi
  IMAGE_TAG="$backup_tag" docker compose up -d --no-deps app || true
  wait_healthy big_winner_app || echo "!!! 回滚后仍未恢复 healthy，请人工介入"
  return 0
}

echo ">>> 启动 app"
if ! docker compose up -d app; then
  echo "!!! 启动命令失败"
  rollback
  exit 1
fi
if ! wait_healthy big_winner_app; then
  echo "!!! 健康检查失败"
  rollback
  exit 1
fi

# 清理历史回滚 tag，仅保留最近 3 个（rollback-<时间戳> 字典序即时间序）
old_tags="$(docker images "$IMAGE_NAME" --format '{{.Tag}}' | grep '^rollback-' | sort -r | tail -n +4 || true)"
if [ -n "$old_tags" ]; then
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    docker rmi "$IMAGE_NAME:$tag" >/dev/null 2>&1 || true
  done <<<"$old_tags"
fi

echo ">>> 部署完成: $IMAGE_NAME:$IMAGE_TAG"
