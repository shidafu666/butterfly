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
export ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.cn"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

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

    echo "── [6/6] redis (pull & tag) ──"
    docker pull --platform linux/amd64 redis:7-alpine
    docker tag redis:7-alpine "${ACR_LOGIN_SERVER}/butterfly/redis:7-alpine"

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
    docker push "${ACR_LOGIN_SERVER}/butterfly/redis:7-alpine"

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
    echo "完整部署流程:"
    echo "  1. cp .env.aci.example .env.aci  # 填写配置"
    echo "  2. make aci-login                 # 登录 Azure"
    echo "  3. make aci-db-init               # 初始化数据库 (首次)"
    echo "  4. make aci-all                   # 构建 + 推送 + 部署"
    ;;
esac
