# CyberBee — 电流数据采集与可视化平台
# Usage: make <target>  |  make help

.DEFAULT_GOAL := help

# ─── Colors ───────────────────────────────────────────────────────────────────
BOLD   := \033[1m
RESET  := \033[0m
CYAN   := \033[36m

# ─── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show this help
	@printf '$(BOLD)CyberBee — 电流数据采集与可视化平台$(RESET)\n\n'
	@printf '$(BOLD)Usage:$(RESET)  make $(CYAN)<target>$(RESET)  [VAR=value]\n\n'
	@awk 'BEGIN {FS = ":.*##"}; \
	      /^## / { printf "\n$(BOLD)%s$(RESET)\n", substr($$0, 4) }; \
	      /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2 }' \
	  $(MAKEFILE_LIST)

# ─── Dependencies ─────────────────────────────────────────────────────────────
## Dependencies
.PHONY: install
install: ## Install all workspace dependencies
	pnpm install

# ─── Dev servers ──────────────────────────────────────────────────────────────
## Development
.PHONY: dev-backend dev-frontend dev-ingestion dev-export
dev-backend: ## Start backend in watch mode
	pnpm --filter backend dev

dev-frontend: ## Start frontend dev server (localhost:3000)
	pnpm --filter frontend dev

dev-ingestion: ## Start ingestion worker in dev mode
	pnpm --filter ingestion-worker dev

dev-export: ## Start export worker in dev mode
	pnpm --filter export-worker dev

# ─── Build ────────────────────────────────────────────────────────────────────
## Build
.PHONY: build build-backend build-frontend
build: ## Build all packages and apps
	pnpm run build:all

build-backend: ## Build backend only
	pnpm --filter backend build

build-frontend: ## Build frontend only
	pnpm --filter frontend build

# ─── Code quality ─────────────────────────────────────────────────────────────
## Code quality
.PHONY: typecheck lint
typecheck: ## TypeScript type-check across all packages
	pnpm run typecheck

lint: ## Run linters across all packages
	pnpm run lint

# ─── Docker / Services ────────────────────────────────────────────────────────
## Docker / Services
.PHONY: up down restart rebuild reset ps

up: ## Start all services (builds images if needed)
	@bash scripts/up.sh

down: ## Stop all services
	@bash scripts/down.sh

restart: down up ## Stop then start all services

rebuild: ## Rebuild & recreate app containers only (no infra restart)
	docker compose up -d --build --force-recreate \
	  backend frontend ingestion-worker export-worker

reset: ## ⚠ DESTRUCTIVE — wipe data directories and restart fresh
	@bash scripts/reset.sh

ps: ## Show running container status
	docker compose ps

# ─── Logs ─────────────────────────────────────────────────────────────────────
## Logs  (Ctrl-C to stop)
.PHONY: logs logs-backend logs-frontend logs-ingestion logs-export logs-infra

logs: ## Tail all service logs
	docker compose logs -f --tail=100

logs-backend: ## Tail backend logs
	docker compose logs -f --tail=100 backend

logs-frontend: ## Tail frontend logs
	docker compose logs -f --tail=100 frontend

logs-ingestion: ## Tail ingestion-worker logs
	docker compose logs -f --tail=100 ingestion-worker

logs-export: ## Tail export-worker logs
	docker compose logs -f --tail=100 export-worker

logs-infra: ## Tail postgres / redis / mosquitto logs
	docker compose logs -f --tail=100 postgres redis mosquitto

# ─── Database ─────────────────────────────────────────────────────────────────
## Database
.PHONY: db-push db-generate db-shell migrate

migrate: ## Apply pending SQL migrations to the local database
	@bash scripts/migrate.sh --local

db-push: ## Push Prisma schema changes to the database
	pnpm --filter backend prisma:push

db-generate: ## Regenerate Prisma client after schema changes
	pnpm --filter backend prisma:generate

db-shell: ## Open a psql shell inside the postgres container
	docker exec -it butterfly-postgres \
	  psql -U $${POSTGRES_USER:-app} -d $${POSTGRES_DB:-current_platform}

# ─── Utilities ────────────────────────────────────────────────────────────────
## Utilities

.PHONY: test-mqtt set-retention scale-ingestion

test-mqtt: ## Send test MQTT data  (HOURS=24 SENSOR_SN=863434080879965 BROKER_URL=mqtt://localhost:1883)
	@set -a && . ./.env && set +a && \
	HOURS=$(or $(HOURS),3) \
	BROKER_URL=$(or $(BROKER_URL),$$BROKER_URL) \
	MQTT_USERNAME=$(or $(MQTT_USERNAME),$$MQTT_USERNAME) \
	MQTT_PASSWORD=$(or $(MQTT_PASSWORD),$$MQTT_PASSWORD) \
	node scripts/test-mqtt.js \
	  $(or $(BROKER_URL),$$BROKER_URL) \
	  $(or $(SENSOR_SN),863434080879965) \
	  $(or $(MQTT_USERNAME),$$MQTT_USERNAME) \
	  $(or $(MQTT_PASSWORD),$$MQTT_PASSWORD) \
	  $(or $(HOURS),3)

set-retention: ## Set raw data retention  (DAYS=30)
	@[ -n "$(DAYS)" ] || { echo "Usage: make set-retention DAYS=<number>"; exit 1; }
	@bash scripts/set-retention.sh $(DAYS)

scale-ingestion: ## Scale ingestion workers  (N=3)
	@[ -n "$(N)" ] || { echo "Usage: make scale-ingestion N=<number>"; exit 1; }
	docker compose up -d --scale ingestion-worker=$(N) ingestion-worker

# ─── Azure 全栈部署 (Web App + Container App + ACI) ──────────────────────────
## Azure 全栈部署 (Azure China)
.PHONY: azure-login azure-build azure-push azure-migrate azure-ensure-storage \
        azure-deploy-mqtt azure-deploy-services azure-deploy-web azure-all \
        azure-status azure-logs-web azure-logs-services azure-logs-mqtt azure-db-init

azure-login: ## 登录 Azure China 和 ACR
	@bash scripts/deploy-azure.sh login

azure-build: ## 通过 ACR Tasks 云端构建镜像 (linux/amd64，无需本地 Docker): web / ingestion-worker / export-worker / mosquitto
	@bash scripts/deploy-azure.sh build

azure-push: ## (no-op) 镜像已在 azure-build 阶段直接推送到 ACR
	@bash scripts/deploy-azure.sh push

azure-migrate: ## 应用待执行的数据库迁移
	@bash scripts/deploy-azure.sh migrate

azure-ensure-storage: ## 创建 butterfly-exports File Share 并挂载到 Web App 和 Container Apps（幂等）
	@bash scripts/deploy-azure.sh ensure-storage

azure-deploy-mqtt: ## 部署/更新 Mosquitto ACI (dev-butterfly)
	@bash scripts/deploy-azure.sh deploy-mqtt

azure-deploy-services: ## 更新 Container App cyberbee-services (ingestion-worker + export-worker)
	@bash scripts/deploy-azure.sh deploy-services

azure-deploy-web: ## 更新 cyberbee Web App 容器镜像和配置
	@bash scripts/deploy-azure.sh deploy-web

azure-all: ## 一键全栈部署: build → migrate → ensure-storage → deploy-mqtt → deploy-services → deploy-web
	@bash scripts/deploy-azure.sh all

azure-status: ## 查看 Web App / Container App / ACI 状态和访问地址
	@bash scripts/deploy-azure.sh status

azure-logs-web: ## 查看 Web App 日志流
	@bash scripts/deploy-azure.sh logs-web

azure-logs-services: ## 查看 Container App 日志流  (CONTAINER=ingestion-worker|export-worker)
	@bash scripts/deploy-azure.sh logs-services $(or $(CONTAINER),ingestion-worker)

azure-logs-mqtt: ## 查看 Mosquitto ACI 日志
	@bash scripts/deploy-azure.sh logs-mqtt

azure-db-init: ## 初始化 Azure PostgreSQL (启用 TimescaleDB + Schema)
	@bash scripts/deploy-azure.sh db-init
