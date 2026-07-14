# Butterfly — 电流数据采集与可视化平台
# Usage: make <target>  |  make help

.DEFAULT_GOAL := help

# ─── Colors ───────────────────────────────────────────────────────────────────
BOLD   := \033[1m
RESET  := \033[0m
CYAN   := \033[36m

# ─── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show this help
	@printf '$(BOLD)Butterfly — 电流数据采集与可视化平台$(RESET)\n\n'
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

# ─── ACI Deployment (Azure China 21Vianet) ───────────────────────────────────
## ACI 部署 (Azure China)
.PHONY: aci-login aci-build aci-push aci-migrate aci-deploy aci-all aci-status aci-logs aci-delete aci-db-init webapp-deploy

aci-login: ## 登录 Azure China 和 ACR
	@bash scripts/deploy-aci.sh login

aci-build: ## 构建所有镜像 (linux/amd64, 标签=git SHA)
	@bash scripts/deploy-aci.sh build

aci-push: ## 推送所有镜像到 Azure Container Registry (SHA + latest)
	@bash scripts/deploy-aci.sh push

aci-migrate: ## 应用待执行的 SQL 迁移到 Azure 数据库
	@bash scripts/deploy-aci.sh migrate

aci-deploy: ## 部署容器组到 ACI
	@bash scripts/deploy-aci.sh deploy

aci-all: ## 一键部署: 构建 → 推送 → 迁移 → ACI + Web App
	@bash scripts/deploy-aci.sh all

aci-status: ## 查看 ACI 容器组状态和访问地址
	@bash scripts/deploy-aci.sh status

aci-logs: ## 查看 ACI 容器日志  (CONTAINER=backend)
	@bash scripts/deploy-aci.sh logs $(or $(CONTAINER),backend)

aci-delete: ## 删除 ACI 容器组
	@bash scripts/deploy-aci.sh delete

aci-db-init: ## 初始化 Azure PostgreSQL (启用 TimescaleDB + Schema)
	@bash scripts/init-azure-db.sh

webapp-deploy: ## 将 frontend 镜像部署到 Azure Web App（需先 aci-push）
	@bash scripts/deploy-aci.sh webapp-deploy
