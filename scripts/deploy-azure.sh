#!/usr/bin/env bash
# ============================================================
# CyberBee — Azure 全栈部署脚本（Azure China 21Vianet）
# 目标拓扑:
#   cyberbee (Web App)            — butterfly/web 合并镜像
#   cyberbee-services (Container App) — ingestion-worker + export-worker
#   dev-butterfly (ACI)           — Mosquitto MQTT
#   cyberbee (Redis)              — Azure Cache for Redis TLS:6380
#   cyberbeestorage               — butterfly-exports File Share
#   butterfly-pg                  — 既有 PostgreSQL，不迁移
#
# Usage: bash scripts/deploy-azure.sh <action> [args]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="${PROJECT_ROOT}/.env.azure"
INFRA_DIR="${PROJECT_ROOT}/infra/azure"
MOSQUITTO_TPL="${INFRA_DIR}/mosquitto-aci.yaml.tpl"

# Temporary directory: deleted automatically on exit.
TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

# Preserve caller-supplied IMAGE_TAG before .env.azure can overwrite it.
CALLER_IMAGE_TAG="${IMAGE_TAG:-}"

# ─── Load .env.azure ──────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.azure not found."
  echo "   cp .env.azure.example .env.azure  # then fill in your values"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

export ACR_LOGIN_SERVER="${ACR_LOGIN_SERVER:-${ACR_NAME}.azurecr.cn}"

# ─── Image tag ────────────────────────────────────────────────
if [ -n "$CALLER_IMAGE_TAG" ]; then
  IMAGE_TAG="$CALLER_IMAGE_TAG"
else
  GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo nogit)"
  if [ -n "$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null)" ]; then
    GIT_SHA="${GIT_SHA}-dirty.$(date +%Y%m%d%H%M%S)"
  fi
  IMAGE_TAG="$GIT_SHA"
fi
export IMAGE_TAG
echo "🏷️  Image tag: ${IMAGE_TAG}"

# ─── Helpers ──────────────────────────────────────────────────

# Resolve image to immutable ACR digest reference.
# Each deploy uses @sha256:... so the service always rolls to the new image.
resolve_digest() {
  local svc="$1" tag="$2"
  local digest
  digest=$(az acr repository show \
    -n "$ACR_NAME" \
    --image "butterfly/${svc}:${tag}" \
    --query digest -o tsv 2>/dev/null || true)
  if [ -z "$digest" ]; then
    echo "❌ butterfly/${svc}:${tag} not found in ACR — run 'make azure-push' first." >&2
    return 1
  fi
  echo "${ACR_LOGIN_SERVER}/butterfly/${svc}@${digest}"
}

fetch_acr_creds() {
  ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
  ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)
  export ACR_USERNAME ACR_PASSWORD
}

fetch_redis_creds() {
  REDIS_HOST=$(az redis show \
    --name "$REDIS_CACHE_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query hostName -o tsv)
  REDIS_PASSWORD=$(az redis list-keys \
    --name "$REDIS_CACHE_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query primaryKey -o tsv)
  export REDIS_HOST REDIS_PASSWORD
}

fetch_storage_key() {
  AZURE_STORAGE_KEY=$(az storage account keys list \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --account-name "$AZURE_STORAGE_ACCOUNT" \
    --query "[0].value" -o tsv)
  export AZURE_STORAGE_KEY
}

# ─── Action dispatcher ────────────────────────────────────────
ACTION="${1:-help}"

case "$ACTION" in

# ── Login ──────────────────────────────────────────────────────
login)
  echo "🔐 Switching to AzureChinaCloud..."
  az cloud set --name AzureChinaCloud 2>/dev/null || true
  az login
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  echo "🔐 Logging into ACR: ${ACR_LOGIN_SERVER}..."
  az acr login --name "$ACR_NAME"
  echo "✅ Login complete."
  ;;

# ── Build (cloud build via ACR Tasks — no local Docker required) ──
build)
  echo "🔨 Building 4 images via ACR Tasks (linux/amd64, tag: ${IMAGE_TAG})..."
  cd "$PROJECT_ROOT"

  echo "── [1/4] web (frontend + backend merged) ──"
  az acr build \
    --registry "$ACR_NAME" \
    --image "butterfly/web:${IMAGE_TAG}" \
    --file apps/web/Dockerfile.azure \
    --platform linux/amd64 \
    .

  echo "── [2/4] ingestion-worker ──"
  az acr build \
    --registry "$ACR_NAME" \
    --image "butterfly/ingestion-worker:${IMAGE_TAG}" \
    --file apps/ingestion-worker/Dockerfile \
    --platform linux/amd64 \
    .

  echo "── [3/4] export-worker ──"
  az acr build \
    --registry "$ACR_NAME" \
    --image "butterfly/export-worker:${IMAGE_TAG}" \
    --file apps/export-worker/Dockerfile \
    --platform linux/amd64 \
    .

  echo "── [4/4] mosquitto ──"
  az acr build \
    --registry "$ACR_NAME" \
    --image "butterfly/mosquitto:${IMAGE_TAG}" \
    --file infra/aci/Dockerfile.mosquitto \
    --platform linux/amd64 \
    infra/docker/mosquitto/

  # Tag each image as 'latest' as well
  if [ "$IMAGE_TAG" != "latest" ]; then
    for svc in web ingestion-worker export-worker mosquitto; do
      az acr import \
        --name "$ACR_NAME" \
        --source "${ACR_LOGIN_SERVER}/butterfly/${svc}:${IMAGE_TAG}" \
        --image "butterfly/${svc}:latest" \
        --force 2>/dev/null || true
    done
  fi

  echo "✅ All images built and pushed to ACR."
  ;;

# ── Push (no-op: ACR Tasks push during build) ─────────────────
push)
  echo "ℹ️  'push' is a no-op when using ACR Tasks — images are pushed during 'build'."
  echo "   Run: $0 build"
  ;;

# ── Migrate ────────────────────────────────────────────────────
migrate)
  echo "🗄️  Applying database migrations..."
  bash "${SCRIPT_DIR}/migrate.sh"
  ;;

# ── Ensure storage (idempotent) ────────────────────────────────
ensure-storage)
  echo "🗂️  Ensuring butterfly-exports File Share and mounts..."

  fetch_storage_key

  # Create file share (no-op if it already exists)
  az storage share create \
    --name "$AZURE_FILE_SHARE_NAME" \
    --account-name "$AZURE_STORAGE_ACCOUNT" \
    --account-key "$AZURE_STORAGE_KEY" \
    --output none 2>/dev/null || true
  echo "   ✅ File share '${AZURE_FILE_SHARE_NAME}' ready."

  # Register storage binding with Container Apps environment
  echo "   Registering storage with Container Apps environment '${CONTAINER_APP_ENV}'..."
  az containerapp env storage set \
    --name "$CONTAINER_APP_ENV" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --storage-name "butterfly-exports-storage" \
    --azure-file-account-name "$AZURE_STORAGE_ACCOUNT" \
    --azure-file-account-key "$AZURE_STORAGE_KEY" \
    --azure-file-share-name "$AZURE_FILE_SHARE_NAME" \
    --access-mode ReadWrite \
    --output none
  echo "   ✅ Container Apps environment storage binding ready."

  # Mount to Web App (try update first for idempotency, fall back to add)
  echo "   Mounting File Share to Web App '${AZURE_WEBAPP_NAME}'..."
  if az webapp config storage-account update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --custom-id "butterfly-exports" \
    --storage-type AzureFiles \
    --account-name "$AZURE_STORAGE_ACCOUNT" \
    --share-name "$AZURE_FILE_SHARE_NAME" \
    --access-key "$AZURE_STORAGE_KEY" \
    --mount-path "/app/exports" \
    --output none 2>/dev/null; then
    echo "   ✅ Web App storage mount updated."
  else
    az webapp config storage-account add \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --custom-id "butterfly-exports" \
      --storage-type AzureFiles \
      --account-name "$AZURE_STORAGE_ACCOUNT" \
      --share-name "$AZURE_FILE_SHARE_NAME" \
      --access-key "$AZURE_STORAGE_KEY" \
      --mount-path "/app/exports" \
      --output none
    echo "   ✅ Web App storage mount created."
  fi
  echo "✅ Storage setup complete."
  ;;

# ── Deploy Mosquitto ACI ───────────────────────────────────────
deploy-mqtt)
  echo "📡 Deploying Mosquitto ACI '${ACI_MQTT_NAME}'..."

  # ACI_LOCATION defaults to AZURE_LOCATION; override in .env.azure when the
  # MQTT ACI is in a different region from the rest of the app resources.
  # ACI is only available in chinaeast2 and chinanorth3.
  export ACI_LOCATION="${ACI_LOCATION:-${AZURE_LOCATION}}"
  echo "   ACI location: ${ACI_LOCATION}"

  export MOSQUITTO_IMAGE
  MOSQUITTO_IMAGE="$(resolve_digest mosquitto "$IMAGE_TAG")"

  fetch_acr_creds
  echo "   Mosquitto image: ${MOSQUITTO_IMAGE}"

  MQTT_ACI_YAML="${TEMP_DIR}/mosquitto-aci.yaml"
  envsubst < "$MOSQUITTO_TPL" > "$MQTT_ACI_YAML"

  az container create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --file "$MQTT_ACI_YAML" \
    --output none

  FQDN=$(az container show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$ACI_MQTT_NAME" \
    --query "ipAddress.fqdn" -o tsv 2>/dev/null || echo "<pending>")
  echo "✅ MQTT ACI deployed."
  echo "   FQDN: ${FQDN}"
  echo "   MQTT: mqtt://${FQDN}:1883"
  echo ""
  echo "   ⚠️  Update MQTT_URL in .env.azure to: mqtt://${FQDN}:1883"
  echo "   Then redeploy services: make azure-deploy-services"
  ;;

# ── Deploy Container App (two worker containers) ───────────────
deploy-services)
  echo "🐝 Updating Container App '${CONTAINER_APP_NAME}'..."

  INGESTION_WORKER_IMAGE="$(resolve_digest ingestion-worker "$IMAGE_TAG")"
  EXPORT_WORKER_IMAGE="$(resolve_digest export-worker "$IMAGE_TAG")"
  echo "   ingestion-worker: ${INGESTION_WORKER_IMAGE}"
  echo "   export-worker:    ${EXPORT_WORKER_IMAGE}"

  # Fetch all credentials at deploy time — not stored in any file.
  fetch_acr_creds
  fetch_redis_creds
  # Note: we don't need storage key here since the env storage binding is
  # already created by ensure-storage; the volume reference uses the binding name.

  # Get Container Apps environment resource ID
  ENV_ID=$(az containerapp env show \
    --name "$CONTAINER_APP_ENV" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query id -o tsv)

  # Build the Container App patch JSON via jq so that all string values are
  # safely escaped (handles passwords with $, ", \, : etc.).
  PATCH_JSON=$(jq -n \
    --arg acr_server    "$ACR_LOGIN_SERVER" \
    --arg acr_username  "$ACR_USERNAME" \
    --arg acr_password  "$ACR_PASSWORD" \
    --arg db_url        "$DATABASE_URL" \
    --arg redis_host    "$REDIS_HOST" \
    --arg redis_pw      "$REDIS_PASSWORD" \
    --arg mqtt_url      "${MQTT_URL:-}" \
    --arg mqtt_user     "$MQTT_USERNAME" \
    --arg mqtt_pw       "$MQTT_PASSWORD" \
    --arg ingestion_img "$INGESTION_WORKER_IMAGE" \
    --arg export_img    "$EXPORT_WORKER_IMAGE" \
    --arg concurrency   "${INGESTION_CONCURRENCY:-10}" \
    --arg pool_max      "${DB_POOL_MAX:-20}" \
    '{
      properties: {
        configuration: {
          activeRevisionsMode: "Single",
          registries: [{
            server: $acr_server,
            username: $acr_username,
            passwordSecretRef: "acr-password"
          }],
          secrets: [
            { name: "acr-password",   value: $acr_password },
            { name: "database-url",   value: $db_url },
            { name: "redis-password", value: $redis_pw },
            { name: "mqtt-password",  value: $mqtt_pw }
          ]
        },
        template: {
          containers: [
            {
              name:  "ingestion-worker",
              image: $ingestion_img,
              resources: { cpu: 0.5, memory: "1Gi" },
              env: [
                { name: "NODE_ENV",              value: "production" },
                { name: "DATABASE_URL",          secretRef: "database-url" },
                { name: "MQTT_URL",              value: $mqtt_url },
                { name: "MQTT_TOPIC",            value: "wlpca/+/data" },
                { name: "MQTT_CLIENT_ID",        value: "current-platform-ingestion-worker" },
                { name: "MQTT_SHARED_GROUP",     value: "ingestion-workers" },
                { name: "MQTT_USERNAME",         value: $mqtt_user },
                { name: "MQTT_PASSWORD",         secretRef: "mqtt-password" },
                { name: "INGESTION_CONCURRENCY", value: $concurrency },
                { name: "DB_POOL_MAX",           value: $pool_max }
              ]
            },
            {
              name:  "export-worker",
              image: $export_img,
              resources: { cpu: 0.5, memory: "1Gi" },
              env: [
                { name: "NODE_ENV",      value: "production" },
                { name: "DATABASE_URL",  secretRef: "database-url" },
                { name: "REDIS_HOST",    value: $redis_host },
                { name: "REDIS_PORT",    value: "6380" },
                { name: "REDIS_PASSWORD", secretRef: "redis-password" },
                { name: "REDIS_TLS",     value: "true" },
                { name: "EXPORT_DIR",    value: "/app/exports" }
              ],
              volumeMounts: [{ volumeName: "exports", mountPath: "/app/exports" }]
            }
          ],
          scale: { minReplicas: 1, maxReplicas: 1 },
          volumes: [{
            name:        "exports",
            storageType: "AzureFile",
            storageName: "butterfly-exports-storage"
          }]
        }
      }
    }')

  # PATCH via ARM REST API (relative URL — az handles China endpoint automatically).
  az rest \
    --method PATCH \
    --url "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.App/containerApps/${CONTAINER_APP_NAME}?api-version=2023-05-01" \
    --headers "Content-Type=application/json" \
    --body "$PATCH_JSON" \
    --output none

  echo "✅ Container App '${CONTAINER_APP_NAME}' updated."
  az containerapp show \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "properties.latestRevisionName" -o tsv
  ;;

# ── Deploy Web App ─────────────────────────────────────────────
deploy-web)
  : "${AZURE_WEBAPP_NAME:?AZURE_WEBAPP_NAME must be set in .env.azure}"
  echo "🌐 Deploying Web App '${AZURE_WEBAPP_NAME}'..."

  WEB_IMAGE="$(resolve_digest web "$IMAGE_TAG")"
  echo "   web image: ${WEB_IMAGE}"

  fetch_acr_creds
  fetch_redis_creds

  # Update container image
  az webapp config container set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --container-image-name "$WEB_IMAGE" \
    --container-registry-url "https://${ACR_LOGIN_SERVER}" \
    --container-registry-user "$ACR_USERNAME" \
    --container-registry-password "$ACR_PASSWORD" \
    --output none

  # Set runtime environment variables.
  # Redis/ACR credentials are fetched above and passed directly; they are not
  # written to any file.
  az webapp config appsettings set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --settings \
      "WEBSITES_PORT=3000" \
      "NODE_ENV=production" \
      "KEEP_ALIVE_TIMEOUT=65000" \
      "REDIS_HOST=${REDIS_HOST}" \
      "REDIS_PORT=6380" \
      "REDIS_PASSWORD=${REDIS_PASSWORD}" \
      "REDIS_TLS=true" \
      "DATABASE_URL=${DATABASE_URL}" \
      "JWT_SECRET=${JWT_SECRET}" \
      "JWT_EXPIRES_IN=${JWT_EXPIRES_IN}" \
      "COOKIE_SECRET=${COOKIE_SECRET}" \
      "EXPORT_DIR=/app/exports" \
      "SENSOR_ACTIVE_THRESHOLD_HOURS=${SENSOR_ACTIVE_THRESHOLD_HOURS}" \
      "EXPORT_JOB_RETENTION_HOURS=${EXPORT_JOB_RETENTION_HOURS}" \
      "INITIAL_ADMIN_EMAIL=${INITIAL_ADMIN_EMAIL}" \
      "INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD}" \
      "INITIAL_ADMIN_NAME=${INITIAL_ADMIN_NAME}" \
      "ENTRA_CLIENT_ID=${ENTRA_CLIENT_ID:-}" \
      "ENTRA_CLIENT_SECRET=${ENTRA_CLIENT_SECRET:-}" \
      "ENTRA_TENANT_ID=${ENTRA_TENANT_ID:-}" \
      "ENTRA_REDIRECT_URI=${ENTRA_REDIRECT_URI:-}" \
      "ENTRA_POST_LOGIN_REDIRECT=${ENTRA_POST_LOGIN_REDIRECT:-}" \
    --output none

  # HTTPS-only + Always On
  az webapp update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --https-only true \
    --output none

  az webapp config set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --always-on true \
    --output none

  # Health check path (App Service probes this URL)
  az webapp config set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --generic-configurations '{"healthCheckPath":"/health"}' \
    --output none

  # Restart to apply new image and settings
  az webapp restart \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --output none

  echo "✅ Web App deployed: https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn"
  echo "   Health: https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn/health"
  ;;

# ── Full deployment ────────────────────────────────────────────
all)
  echo "🚀 Full Azure deployment (tag: ${IMAGE_TAG})"
  "$0" build
  "$0" migrate
  "$0" ensure-storage
  "$0" deploy-mqtt
  "$0" deploy-services
  "$0" deploy-web
  echo ""
  "$0" status
  echo "✅ Full deployment complete."
  ;;

# ── Status ─────────────────────────────────────────────────────
status)
  echo "📊 Deployment Status"
  echo ""
  echo "── Web App: ${AZURE_WEBAPP_NAME} ──"
  az webapp show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --query "{State:state, URL:defaultHostName}" \
    --output table 2>/dev/null || echo "   (not found)"
  echo ""
  echo "── Container App: ${CONTAINER_APP_NAME} ──"
  az containerapp show \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --query "{Name:name, LatestRevision:properties.latestRevisionName}" \
    --output table 2>/dev/null || echo "   (not found)"
  echo ""
  echo "── MQTT ACI: ${ACI_MQTT_NAME} ──"
  az container show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$ACI_MQTT_NAME" \
    --query "containers[].{Name:name, State:instanceView.currentState.state}" \
    --output table 2>/dev/null || echo "   (not found)"
  MQTT_FQDN=$(az container show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$ACI_MQTT_NAME" \
    --query "ipAddress.fqdn" -o tsv 2>/dev/null || echo "<pending>")
  echo ""
  echo "🌐 Endpoints:"
  echo "   Web App:  https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn"
  echo "   Health:   https://${AZURE_WEBAPP_NAME}.chinacloudsites.cn/health"
  echo "   MQTT:     mqtt://${MQTT_FQDN}:1883"
  ;;

# ── Logs ───────────────────────────────────────────────────────
logs-web)
  az webapp log tail \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME"
  ;;

logs-services)
  CONTAINER="${2:-ingestion-worker}"
  az containerapp logs show \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --container "$CONTAINER" \
    --follow true
  ;;

logs-mqtt)
  az container logs \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$ACI_MQTT_NAME" \
    --container-name mosquitto
  ;;

# ── DB init ─────────────────────────────────────────────────────
db-init)
  bash "${SCRIPT_DIR}/init-azure-db.sh"
  ;;

# ── Help ───────────────────────────────────────────────────────
help|*)
  echo "CyberBee — Azure 全栈部署脚本 (Azure China 21Vianet)"
  echo ""
  echo "Usage: $0 <action>"
  echo ""
  echo "Actions:"
  echo "  login               登录 Azure China 和 ACR"
  echo "  build               通过 ACR Tasks 云端构建 4 个镜像 (linux/amd64，无需本地 Docker): web / ingestion-worker / export-worker / mosquitto"
  echo "  push                (no-op) 镜像已在 build 阶段直接推送到 ACR"
  echo "  migrate             应用数据库迁移"
  echo "  ensure-storage      创建 File Share 并挂载到 Web App 和 Container Apps（幂等）"
  echo "  deploy-mqtt         部署/更新 Mosquitto ACI (dev-butterfly)"
  echo "  deploy-services     更新 Container App (ingestion-worker + export-worker)"
  echo "  deploy-web          更新 Web App 容器镜像和配置 (cyberbee)"
  echo "  all                 完整部署: build → migrate → ensure-storage → deploy-mqtt → deploy-services → deploy-web"
  echo "  status              查看所有组件状态和访问地址"
  echo "  logs-web            Web App 日志流"
  echo "  logs-services       Container App 日志流 (CONTAINER=ingestion-worker|export-worker)"
  echo "  logs-mqtt           MQTT ACI 日志"
  echo "  db-init             初始化 Azure PostgreSQL (TimescaleDB 等)"
  echo ""
  echo "完整部署流程:"
  echo "  1. cp .env.azure.example .env.azure   # 填写配置"
  echo "  2. make azure-login                   # 登录 Azure"
  echo "  3. make azure-db-init                 # 初始化数据库（首次）"
  echo "  4. make azure-all                     # 构建 → 推送 → 迁移 → 部署"
  echo ""
  echo "可选固定镜像标签:"
  echo "  IMAGE_TAG=my-release make azure-all"
  ;;
esac
