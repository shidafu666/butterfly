#!/usr/bin/env bash
# ============================================================
# Butterfly — ACI 部署脚本（Azure China 21Vianet）
# Usage: bash scripts/deploy-aci.sh <action>
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="${PROJECT_ROOT}/.env.aci"
TEMPLATE_FILE="${PROJECT_ROOT}/infra/aci/deploy.yaml.tpl"
OUTPUT_FILE="${PROJECT_ROOT}/infra/aci/deploy.yaml"

# ─── Load .env.aci ────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.aci not found."
  echo "   cp .env.aci.example .env.aci  # then fill in your values"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# Derived variables
export ACR_LOGIN_SERVER="${ACR_LOGIN_SERVER:-${ACR_NAME}.azurecr.cn}"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

# Redis strategy is fully automatic:
# - keep one universal tag for runtime use
# - auto-publish arm64 (when host is arm64) and always ensure amd64 for ACI
REDIS_IMAGE_TAG="7-alpine"
REDIS_SOURCE_IMAGE="docker.io/library/redis:7-alpine"
export REDIS_IMAGE_TAG

resolve_arch_digest() {
  local source_ref="$1"
  local arch="$2"
  echo "   Resolving ${arch} digest from manifest: ${source_ref}"
  docker manifest inspect "$source_ref" | jq -r --arg arch "$arch" '.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch) | .digest' | head -n1
}

source_repo_without_tag_or_digest() {
  local source_ref="$1"
  echo "$source_ref" | sed 's/@.*$//' | sed 's/:[^/:]*$//'
}

local_image_has_arch() {
  local image_ref="$1"
  local expected_arch="$2"
  local actual_arch

  actual_arch=$(docker image inspect "$image_ref" --format '{{.Architecture}}' 2>/dev/null || true)
  [ "$actual_arch" = "$expected_arch" ]
}

ensure_local_redis_arch_cache() {
  local arch="$1"
  local local_tag="$2"

  if local_image_has_arch "$local_tag" "$arch"; then
    echo "   Reusing local Redis cache for ${arch}: ${local_tag}"
    return
  fi

  local source_repo
  local arch_digest
  local arch_ref

  source_repo=$(source_repo_without_tag_or_digest "$REDIS_SOURCE_IMAGE")
  arch_digest=$(resolve_arch_digest "$REDIS_SOURCE_IMAGE" "$arch")

  if [ -z "$arch_digest" ] || [ "$arch_digest" = "null" ]; then
    echo "❌ Failed to resolve ${arch} digest for ${REDIS_SOURCE_IMAGE}"
    return 1
  fi

  arch_ref="${source_repo}@${arch_digest}"
  echo "   Pulling Redis for ${arch} by digest: ${arch_digest}"
  docker pull "$arch_ref"

  local pulled_arch
  docker tag "$arch_ref" "$local_tag"
  pulled_arch=$(docker image inspect "$local_tag" --format '{{.Architecture}}' 2>/dev/null || true)
  if [ "$pulled_arch" != "$arch" ]; then
    echo "❌ Pulled Redis architecture is ${pulled_arch}, expected ${arch}"
    return 1
  fi
}

import_redis_image_via_acr_import() {
  local source_ref="$REDIS_SOURCE_IMAGE"
  echo "   Importing upstream Redis manifest/image: ${source_ref}"

  az acr import \
    --name "$ACR_NAME" \
    --source "$source_ref" \
    --image "butterfly/redis:${REDIS_IMAGE_TAG}" \
    --force >/dev/null
}

import_redis_image_via_local_copy() {
  local dest_ref="${ACR_LOGIN_SERVER}/butterfly/redis:${REDIS_IMAGE_TAG}"
  local local_amd64_tag="butterfly-local/redis:${REDIS_IMAGE_TAG}-amd64"
  local acr_amd64_tag="${ACR_LOGIN_SERVER}/butterfly/redis:${REDIS_IMAGE_TAG}-amd64"

  # ACI needs amd64. Reuse local amd64 cache if present, otherwise pull it.
  ensure_local_redis_arch_cache "amd64" "$local_amd64_tag"
  echo "   Pushing Redis amd64 tag to ACR: ${acr_amd64_tag}"
  docker tag "$local_amd64_tag" "$acr_amd64_tag"
  docker push "$acr_amd64_tag"

  # For ACI deployment, keep runtime tag pinned to amd64 source.
  if docker buildx imagetools version >/dev/null 2>&1; then
    echo "   Creating Redis runtime tag from amd64 only: ${dest_ref}"
    docker buildx imagetools create --tag "$dest_ref" "$acr_amd64_tag"
    return
  fi

  echo "   docker buildx imagetools unavailable; falling back to docker manifest commands..."
  docker manifest create "$dest_ref" "$acr_amd64_tag"
  docker manifest push --purge "$dest_ref"
}

import_redis_image() {
  echo "   Redis import mode: automatic"
  echo "   - prefer local amd64 cache"
  echo "   - pull amd64 from source only when cache is missing"
  import_redis_image_via_local_copy
}

# ─── Action dispatcher ────────────────────────────────────────
ACTION="${1:-help}"

case "$ACTION" in

  # ── Login ────────────────────────────────────────────────────
  login)
    echo "🔐 Setting Azure cloud to AzureChinaCloud..."
    az cloud set --name AzureChinaCloud 2>/dev/null || true
    echo "🔐 Logging into Azure..."
    az login
    az account set --subscription "$AZURE_SUBSCRIPTION_ID"
    echo "🔐 Logging into ACR: ${ACR_LOGIN_SERVER}..."
    az acr login --name "$ACR_NAME"
    echo "✅ Login complete."
    ;;

  # ── Build ────────────────────────────────────────────────────
  build)
    echo "🔨 Building all images for linux/amd64..."
    echo "   (cross-build from ARM64 → AMD64, this may take a few minutes)"
    echo ""
    cd "$PROJECT_ROOT"

    echo "── [1/6] backend ──"
    docker build --platform linux/amd64 \
      -f apps/backend/Dockerfile \
      -t "${ACR_LOGIN_SERVER}/butterfly/backend:${IMAGE_TAG}" .

    echo "── [2/6] frontend ──"
    docker build --platform linux/amd64 \
      -f apps/frontend/Dockerfile \
      --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}" \
      --build-arg "NEXT_PUBLIC_ENTRA_CLIENT_ID=${NEXT_PUBLIC_ENTRA_CLIENT_ID:-}" \
      --build-arg "NEXT_PUBLIC_ENTRA_TENANT_ID=${NEXT_PUBLIC_ENTRA_TENANT_ID:-}" \
      --build-arg "NEXT_PUBLIC_ENTRA_REDIRECT_URI=${NEXT_PUBLIC_ENTRA_REDIRECT_URI:-}" \
      -t "${ACR_LOGIN_SERVER}/butterfly/frontend:${IMAGE_TAG}" .

    echo "── [3/6] ingestion-worker ──"
    docker build --platform linux/amd64 \
      -f apps/ingestion-worker/Dockerfile \
      -t "${ACR_LOGIN_SERVER}/butterfly/ingestion-worker:${IMAGE_TAG}" .

    echo "── [4/6] export-worker ──"
    docker build --platform linux/amd64 \
      -f apps/export-worker/Dockerfile \
      -t "${ACR_LOGIN_SERVER}/butterfly/export-worker:${IMAGE_TAG}" .

    echo "── [5/6] mosquitto ──"
    docker build --platform linux/amd64 \
      -f infra/aci/Dockerfile.mosquitto \
      -t "${ACR_LOGIN_SERVER}/butterfly/mosquitto:${IMAGE_TAG}" \
      infra/docker/mosquitto/

    echo "── [6/6] redis ──"
    echo "   Redis is synced to ACR during push (mode: automatic)"
    echo "   Strategy: local amd64 cache first, source fallback"
    echo "   Source fallback: ${REDIS_SOURCE_IMAGE}"

    echo ""
    echo "✅ All images built successfully."
    ;;

  # ── Push ─────────────────────────────────────────────────────
  push)
    echo "📤 Pushing images to ACR: ${ACR_LOGIN_SERVER}..."

    docker push "${ACR_LOGIN_SERVER}/butterfly/backend:${IMAGE_TAG}"
    docker push "${ACR_LOGIN_SERVER}/butterfly/frontend:${IMAGE_TAG}"
    docker push "${ACR_LOGIN_SERVER}/butterfly/ingestion-worker:${IMAGE_TAG}"
    docker push "${ACR_LOGIN_SERVER}/butterfly/export-worker:${IMAGE_TAG}"
    docker push "${ACR_LOGIN_SERVER}/butterfly/mosquitto:${IMAGE_TAG}"

    echo "📥 Importing redis:${REDIS_IMAGE_TAG} into ACR..."
    import_redis_image

    echo "✅ All images pushed."
    ;;

  # ── Generate YAML ────────────────────────────────────────────
  generate-yaml)
    echo "📄 Generating deploy.yaml from template..."

    # Fetch ACR credentials for image pull
    export ACR_USERNAME
    ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
    export ACR_PASSWORD
    ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

    envsubst < "$TEMPLATE_FILE" > "$OUTPUT_FILE"
    echo "✅ Generated: infra/aci/deploy.yaml"
    ;;

  # ── Deploy ───────────────────────────────────────────────────
  deploy)
    # Generate YAML first
    "$0" generate-yaml

    echo "🚀 Deploying container group '${ACI_CONTAINER_GROUP_NAME}' to ACI..."
    az container create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --file "$OUTPUT_FILE"

    echo ""
    echo "✅ Deployment submitted!"
    echo ""

    # Show status
    "$0" status
    ;;

  # ── Status ───────────────────────────────────────────────────
  status)
    echo "📊 Container group status:"
    az container show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --output table 2>/dev/null || echo "   (container group not found)"
    echo ""
    echo "📦 Container states:"
    az container show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --query "containers[].{Name:name, State:instanceView.currentState.state, StartTime:instanceView.currentState.startTime}" \
      --output table 2>/dev/null || true
    echo ""
    echo "🌐 Access endpoints:"
    FQDN=$(az container show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --query "ipAddress.fqdn" -o tsv 2>/dev/null || echo "<pending>")
    IP=$(az container show \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --query "ipAddress.ip" -o tsv 2>/dev/null || echo "<pending>")
    echo "   Frontend:  http://${FQDN}:3000  (or http://${IP}:3000)"
    echo "   Backend:   http://${FQDN}:3001  (or http://${IP}:3001)"
    echo "   MQTT:      mqtt://${FQDN}:1883  (or mqtt://${IP}:1883)"
    ;;

  # ── Logs ─────────────────────────────────────────────────────
  logs)
    CONTAINER="${2:-backend}"
    echo "📋 Logs for container: ${CONTAINER}"
    az container logs \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --container-name "$CONTAINER"
    ;;

  # ── Delete ───────────────────────────────────────────────────
  delete)
    echo "🗑️  Deleting container group '${ACI_CONTAINER_GROUP_NAME}'..."
    az container delete \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$ACI_CONTAINER_GROUP_NAME" \
      --yes
    echo "✅ Container group deleted."
    ;;

  # ── Help ─────────────────────────────────────────────────────
  help|*)
    echo "Butterfly — ACI 部署脚本 (Azure China)"
    echo ""
    echo "Usage: $0 <action> [args]"
    echo ""
    echo "Actions:"
    echo "  login          登录 Azure China 和 ACR"
    echo "  build          构建所有镜像 (linux/amd64)"
    echo "  push           推送所有镜像到 ACR"
    echo "  generate-yaml  从模板生成 deploy.yaml"
    echo "  deploy         生成 YAML 并部署到 ACI"
    echo "  status         查看容器组状态和访问地址"
    echo "  logs [name]    查看容器日志 (默认: backend)"
    echo "                 容器名: redis | mosquitto | backend | frontend"
    echo "                         ingestion-worker | export-worker"
    echo "  delete         删除容器组"
    echo ""
    echo "Redis 行为为脚本内自动策略，无需 .env.aci 配置 REDIS_* 变量"
    echo ""
    echo "完整部署流程:"
    echo "  1. cp .env.aci.example .env.aci  # 填写配置"
    echo "  2. make aci-login                 # 登录 Azure"
    echo "  3. make aci-db-init               # 初始化数据库 (首次)"
    echo "  4. make aci-all                   # 构建 + 推送 + 部署"
    ;;
esac
