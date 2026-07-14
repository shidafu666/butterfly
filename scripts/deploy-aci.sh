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

# Only an IMAGE_TAG exported by the caller should override the automatic tag.
# A historical .env.aci.example set IMAGE_TAG=latest, which made deployments
# depend on a mutable tag and made it hard to tell what code ACI was running.
CALLER_IMAGE_TAG="${IMAGE_TAG:-}"

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
export BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://${ACI_DNS_LABEL}.${AZURE_LOCATION}.azurecontainer.console.azure.cn:3001}"

# Image tag defaults to the current git commit so each deploy produces a
# *different* deploy.yaml — this is what makes ACI actually roll the
# containers (an unchanged `:latest` reference is treated as a no-op).
# A dirty working tree gets a unique `-dirty.<timestamp>` suffix so
# uncommitted rebuilds still roll. Override by exporting IMAGE_TAG yourself.
ENV_FILE_IMAGE_TAG="${IMAGE_TAG:-}"
if [ -n "$CALLER_IMAGE_TAG" ]; then
  IMAGE_TAG="$CALLER_IMAGE_TAG"
elif [ -n "$ENV_FILE_IMAGE_TAG" ] && [ "$ENV_FILE_IMAGE_TAG" != "latest" ]; then
  echo "⚠️  Using IMAGE_TAG from .env.aci: ${ENV_FILE_IMAGE_TAG}"
  echo "   Prefer passing IMAGE_TAG explicitly: IMAGE_TAG=${ENV_FILE_IMAGE_TAG} make aci-all"
  IMAGE_TAG="$ENV_FILE_IMAGE_TAG"
else
  if [ "$ENV_FILE_IMAGE_TAG" = "latest" ]; then
    echo "⚠️  Ignoring IMAGE_TAG=latest from .env.aci; using an immutable deploy tag instead."
  fi
  GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo nogit)"
  if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null)" ]; then
    GIT_SHA="${GIT_SHA}-dirty.$(date +%Y%m%d%H%M%S)"
  fi
  IMAGE_TAG="$GIT_SHA"
fi
export IMAGE_TAG
echo "🏷️  Image tag: ${IMAGE_TAG}"

# Redis strategy is fully automatic:
# - keep one universal tag for runtime use
# - auto-publish arm64 (when host is arm64) and always ensure amd64 for ACI
REDIS_IMAGE_TAG="7-alpine"
REDIS_SOURCE_IMAGE="docker.io/library/redis:7-alpine"
export REDIS_IMAGE_TAG

import_redis_image_via_acr_import() {
  local source_ref="$REDIS_SOURCE_IMAGE"
  echo "   Importing upstream Redis manifest/image: ${source_ref}"

  az acr import \
    --name "$ACR_NAME" \
    --source "$source_ref" \
    --image "butterfly/redis:${REDIS_IMAGE_TAG}" \
    --force >/dev/null
}

import_redis_image() {
  echo "   Importing Redis via ACR: ${REDIS_SOURCE_IMAGE}"
  import_redis_image_via_acr_import
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
    echo "🔨 Building all images via ACR Tasks (linux/amd64)..."
    echo ""
    cd "$PROJECT_ROOT"

    echo "── [1/5] backend ──"
    az acr build \
      --registry "$ACR_NAME" \
      --image "butterfly/backend:${IMAGE_TAG}" \
      --file apps/backend/Dockerfile \
      --platform linux/amd64 \
      .

    echo "── [2/5] frontend ──"
    az acr build \
      --registry "$ACR_NAME" \
      --image "butterfly/frontend:${IMAGE_TAG}" \
      --file apps/frontend/Dockerfile \
      --build-arg "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL:-}" \
      --build-arg "BACKEND_ORIGIN=${BACKEND_ORIGIN}" \
      --platform linux/amd64 \
      .

    echo "── [3/5] ingestion-worker ──"
    az acr build \
      --registry "$ACR_NAME" \
      --image "butterfly/ingestion-worker:${IMAGE_TAG}" \
      --file apps/ingestion-worker/Dockerfile \
      --platform linux/amd64 \
      .

    echo "── [4/5] export-worker ──"
    az acr build \
      --registry "$ACR_NAME" \
      --image "butterfly/export-worker:${IMAGE_TAG}" \
      --file apps/export-worker/Dockerfile \
      --platform linux/amd64 \
      .

    echo "── [5/5] mosquitto ──"
    az acr build \
      --registry "$ACR_NAME" \
      --image "butterfly/mosquitto:${IMAGE_TAG}" \
      --file infra/aci/Dockerfile.mosquitto \
      --platform linux/amd64 \
      infra/docker/mosquitto/

    echo ""
    echo "✅ All images built and pushed to ACR."
    ;;

  # ── Push ─────────────────────────────────────────────────────
  push)
    echo "ℹ️  'push' is a no-op when using ACR Tasks — images are pushed during 'build'."
    echo "   Run: $0 build"

    echo "📥 Importing redis:${REDIS_IMAGE_TAG} into ACR..."
    import_redis_image_via_acr_import

    echo "✅ Done."
    ;;

  # ── Migrate (apply pending SQL migrations to the Azure DB) ───
  migrate)
    echo "🗄️  Applying database migrations to Azure PostgreSQL..."
    # DATABASE_URL is already exported from .env.aci above.
    bash "${SCRIPT_DIR}/migrate.sh"
    ;;

  # ── Generate YAML ────────────────────────────────────────────
  generate-yaml)
    echo "📄 Generating deploy.yaml from template..."

    # Fetch ACR credentials for image pull
    export ACR_USERNAME
    ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
    export ACR_PASSWORD
    ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

    # Pin every image to its current ACR digest (@sha256:...). ACI only rolls a
    # container when its image reference in the group spec changes; a moving tag
    # like ":latest" is byte-identical across deploys, so `az container create`
    # treats it as a no-op and keeps running the OLD image. The immutable digest
    # changes whenever a new image is pushed, so a deploy reliably rolls to the
    # exact image currently behind the tag in ACR.
    echo "   Resolving image digests from ACR (tag: ${IMAGE_TAG})..."
    for spec in \
      "backend:${IMAGE_TAG}" \
      "ingestion-worker:${IMAGE_TAG}" \
      "export-worker:${IMAGE_TAG}" \
      "mosquitto:${IMAGE_TAG}" \
      "redis:${REDIS_IMAGE_TAG}"; do
      svc="${spec%%:*}"
      tag="${spec#*:}"
      digest=$(az acr repository show -n "$ACR_NAME" --image "butterfly/${svc}:${tag}" --query digest -o tsv 2>/dev/null || true)
      if [ -z "$digest" ]; then
        echo "   ❌ butterfly/${svc}:${tag} not found in ACR — run 'make aci-push' first." >&2
        exit 1
      fi
      varname="$(echo "${svc}_IMAGE" | tr 'a-z-' 'A-Z_')"
      export "$varname"="${ACR_LOGIN_SERVER}/butterfly/${svc}@${digest}"
      echo "   • ${svc} → ${digest}"
    done

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

  # ── Deploy frontend to Azure Web App ─────────────────────────
  webapp-deploy)
    : "${AZURE_WEBAPP_NAME:?AZURE_WEBAPP_NAME must be set in .env.aci}"
    echo "🌐 Deploying frontend to Azure Web App '${AZURE_WEBAPP_NAME}'..."
    FRONTEND_DIGEST=$(az acr repository show -n "$ACR_NAME" \
      --image "butterfly/frontend:latest" --query digest -o tsv)
    FRONTEND_REF="${ACR_LOGIN_SERVER}/butterfly/frontend@${FRONTEND_DIGEST}"
    ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
    ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

    az webapp config container set \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --docker-custom-image-name "$FRONTEND_REF" \
      --docker-registry-server-url "https://${ACR_LOGIN_SERVER}" \
      --docker-registry-server-user "$ACR_USERNAME" \
      --docker-registry-server-password "$ACR_PASSWORD"
    az webapp config appsettings set \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --settings WEBSITES_PORT=3000
    az webapp config set \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --generic-configurations '{"healthCheckPath":"/login"}' >/dev/null
    az webapp update \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --https-only true >/dev/null
    echo "✅ Frontend: https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn"
    ;;

  # ── Full deploy flow with one stable IMAGE_TAG ───────────────
  all)
    echo "🚚 Running full deployment with one image tag: ${IMAGE_TAG}"
    "$0" build
    "$0" migrate
    "$0" deploy
    "$0" webapp-deploy
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
    if [ -n "${AZURE_WEBAPP_NAME:-}" ]; then
      echo "   Frontend:  https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn"
    fi
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
    echo "  build          构建所有镜像 (linux/amd64, 标签=git SHA)"
    echo "  push           推送所有镜像到 ACR (SHA 标签 + latest)"
    echo "  migrate        应用待执行的 SQL 迁移到 Azure 数据库"
    echo "  generate-yaml  从模板生成 deploy.yaml"
    echo "  deploy         生成 YAML 并部署到 ACI"
    echo "  all            构建 + 推送 + 迁移 + 部署 ACI 和 Web App"
    echo "  webapp-deploy  将 frontend 镜像部署到 Azure Web App"
    echo "  status         查看容器组状态和访问地址"
    echo "  logs [name]    查看容器日志 (默认: backend)"
    echo "                 容器名: redis | mosquitto | backend | ingestion-worker | export-worker"
    echo "  delete         删除容器组"
    echo ""
    echo "Redis 行为为脚本内自动策略，无需 .env.aci 配置 REDIS_* 变量"
    echo ""
    echo "完整部署流程:"
    echo "  1. cp .env.aci.example .env.aci  # 填写配置"
    echo "  2. make aci-login                 # 登录 Azure"
    echo "  3. make aci-db-init               # 初始化数据库 (首次)"
    echo "  4. make aci-all                   # 构建 + 推送 + 迁移 + 部署"
    echo ""
    echo "可选固定镜像标签:"
    echo "  IMAGE_TAG=my-release make aci-all"
    ;;
esac
