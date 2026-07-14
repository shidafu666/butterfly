# Butterfly Azure China Deployment Guide

This document covers deploying Butterfly to **Azure China (21Vianet)** using the production topology described below. For local Docker Compose deployment, see `DEPLOYMENT.md`.

---

## 1. Deployment Architecture

| Component | Resource | Purpose |
| --------- | -------- | ------- |
| **Web App** | `cyberbee` (Azure App Service) | Runs the merged `butterfly/web` image: Next.js frontend (port 3000) + NestJS backend (loopback 3001). Browser accesses everything via the same origin. |
| **Container App** | `cyberbee-services` | Runs `ingestion-worker` and `export-worker` in a single revision, no external ingress, fixed 1 replica. |
| **ACI** | `dev-butterfly` | Runs Mosquitto only, public TCP `1883`. |
| **Azure Cache for Redis** | `cyberbee` | BullMQ queue and Entra login-code store. Connected via TLS `6380` with access key. |
| **Storage** | `cyberbeestorage` / `butterfly-exports` share | Export files mounted at `/app/exports` on both Web App and Container App. |
| **PostgreSQL** | `butterfly-pg` (existing) | Application database. Not migrated — reused from its current resource group. |
| **ACR** | `cyberbee.azurecr.cn` | Container images. Tagged by git SHA, deployed by digest. |

### Image layout

| Image | Built from | Deployed to |
| ----- | ---------- | ----------- |
| `butterfly/web` | `apps/web/Dockerfile.azure` | Web App `cyberbee` |
| `butterfly/ingestion-worker` | `apps/ingestion-worker/Dockerfile` | Container App `cyberbee-services` |
| `butterfly/export-worker` | `apps/export-worker/Dockerfile` | Container App `cyberbee-services` |
| `butterfly/mosquitto` | `infra/aci/Dockerfile.mosquitto` | ACI `dev-butterfly` |

The `butterfly/web` image runs a PID-1 supervisor (`apps/web/entrypoint.js`) that launches both Node processes and terminates the container if either one exits.

---

## 2. Required Azure Resources

This repo assumes the following resources already exist in Azure China:

1. **Resource Group**
2. **Azure Container Registry**
3. **Azure Storage Account**
4. **Azure File Share** for exports
5. **Azure PostgreSQL Flexible Server**

Recommended naming:

- Keep all resources in the same resource group and region.
- Use `.azurecr.cn` for ACR login server.
- Use `*.postgres.database.chinacloudapi.cn` for Azure PostgreSQL.

Minimum practical setup:

- ACR Basic or above
- PostgreSQL Flexible Server with TimescaleDB support
- Storage Account with one file share for exports
- ACI container group with public DNS label

---

## 3. Local Prerequisites

Before deploying from your machine:

- Azure CLI installed
- Docker installed and running
- `psql` installed
- `make` available
- Access to Azure China subscription

macOS example:

```bash
brew install azure-cli postgresql
```

Check tools:

```bash
az version
docker --version
psql --version
make --version
```

---

## 4. Azure China / Network Caveats

### 4.1 Always use Azure China cloud

The deployment scripts expect Azure China:

```bash
az cloud set --name AzureChinaCloud
```

`make azure-login` already does this.

### 4.2 PostgreSQL firewall must allow your current public IP

`make azure-db-init` connects from **your machine** to Azure PostgreSQL. The PG firewall must allow your current public IP.

If your network changes, you may need to update the PostgreSQL firewall rules again.

### 4.3 Proxy / TUN mode can break PostgreSQL connectivity

HTTP/HTTPS access working normally does **not** guarantee `psql` will work.

Common symptom:

```text
connection to server failed: server closed the connection unexpectedly
```

or:

```text
Operation timed out
```

Typical causes:

1. Your proxy/TUN rewrites DNS to a fake IP such as `198.18.x.x`
2. Raw TCP 5432 traffic is intercepted or not forwarded correctly
3. PostgreSQL firewall does not allow your real public IP

Recommended fixes:

1. Temporarily disable proxy/TUN while running `make azure-db-init`
2. Or add a direct/bypass rule for:
   - `DOMAIN-SUFFIX,chinacloudapi.cn,DIRECT`
   - or the PG server IP / hostname
3. Ensure the PG firewall allows your current public IP

Before running `make azure-db-init`, verify DNS and connectivity:

```bash
nslookup <pg-server>.postgres.database.chinacloudapi.cn
psql "$DATABASE_URL" -c "SELECT version();"
```

If DNS resolves to `198.18.x.x`, your proxy bypass is not effective yet.

---

## 5. Azure Environment File

Copy the template:

```bash
cp .env.azure.example .env.azure
```

Then fill in real values. The deployment script fetches ACR credentials, Redis keys and Storage keys at runtime from the Azure CLI — they do **not** need to be in `.env.azure`.

Key variables:

| Variable                          | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `AZURE_SUBSCRIPTION_ID`           | Azure China subscription ID (pre-filled)                  |
| `AZURE_RESOURCE_GROUP`            | Application resource group (pre-filled)                   |
| `AZURE_LOCATION`                  | Region, e.g. `chinaeast2`                                 |
| `ACR_NAME`                        | ACR resource name (pre-filled: `cyberbee`)                |
| `AZURE_WEBAPP_NAME`               | Web App name (pre-filled: `cyberbee`)                     |
| `CONTAINER_APP_NAME`              | Container App name (pre-filled: `cyberbee-services`)      |
| `REDIS_CACHE_NAME`                | Azure Cache for Redis name (pre-filled: `cyberbee`)       |
| `AZURE_STORAGE_ACCOUNT`           | Storage account (pre-filled: `cyberbeestorage`)           |
| `AZURE_FILE_SHARE_NAME`           | File share name (pre-filled: `butterfly-exports`)         |
| `PG_RESOURCE_GROUP`               | Resource group of the PostgreSQL server (may differ from app RG) |
| `PG_SERVER_NAME`                  | PostgreSQL Flexible Server name (pre-filled: `butterfly-pg`) |
| `DATABASE_URL`                    | Full PostgreSQL connection string                         |
| `MQTT_URL`                        | Mosquitto ACI URL for workers, e.g. `mqtt://<fqdn>:1883` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | MQTT credentials                                          |
| `JWT_SECRET`                      | Backend JWT signing secret                                |
| `INITIAL_ADMIN_*`                 | Initial admin bootstrap account                           |

### 5.1 `DATABASE_URL`

Use Azure PostgreSQL hostname and keep `sslmode=require`:

```env
DATABASE_URL="postgresql://<user>:<password>@<server>.postgres.database.chinacloudapi.cn:5432/postgres?sslmode=require"
```

If the password contains special characters, keep the whole value quoted.

### 5.2 Browser API URL

The merged `butterfly/web` image runs both frontend and backend in the same container. The browser uses the same-origin `/api` path — **no `NEXT_PUBLIC_API_BASE_URL` is needed for the Web App deployment**. Leave it empty.

### 5.3 Secrets

At minimum, replace all placeholders for:

- `MQTT_PASSWORD`
- `JWT_SECRET`
- `COOKIE_SECRET`
- `INITIAL_ADMIN_PASSWORD`
- DB password inside `DATABASE_URL`

Generate strong secrets:

```bash
openssl rand -hex 64
```

---

## 6. Deployment Workflow

The intended flow is:

```bash
make azure-login
make azure-db-init   # first time only
make azure-all
make azure-status
```

`make azure-all` runs build, push, migration, storage setup, and all three service deployments in one script process so every step uses the same immutable image tag. The tag defaults to the current git SHA; if the worktree is dirty, a timestamp suffix is added. To pin a release tag explicitly:

```bash
IMAGE_TAG=my-release make azure-all
```

Detailed steps below.

---

## 7. Step 1: Login to Azure China and ACR

```bash
make azure-login
```

This runs:

- `az cloud set --name AzureChinaCloud`
- `az login`
- `az account set --subscription "$AZURE_SUBSCRIPTION_ID"`
- `az acr login --name "$ACR_NAME"`

If login succeeds, you are ready for both database initialization and image push.

---

## 8. Step 2: Initialize Azure PostgreSQL

Run this once for a new environment, and rerun it if you need to repair aggregate views or database policies:

```bash
make azure-db-init
```

This script does all of the following:

1. Ensures Azure PG allows:
   - `TIMESCALEDB`
   - `PGCRYPTO`
   - `PG_CRON`
2. Ensures `timescaledb` is present in `shared_preload_libraries`
3. Restarts the PostgreSQL server if needed
4. Creates extensions
5. Applies schema and seed SQL
6. Detects TimescaleDB license
7. Chooses the correct aggregate strategy:
   - **Apache license**: standard materialized views + `pg_cron`
   - **TSL/community license**: continuous aggregates
8. Populates Azure materialized views immediately so non-raw historical queries work

### 8.1 Why this step matters

Without `make azure-db-init`:

- tables may not exist
- TimescaleDB may not be loaded
- aggregate queries may fail
- retention and refresh policies may not exist

### 8.2 Known Azure behavior handled by the script

The script already includes workarounds for Azure PG:

- `CREATE EXTENSION timescaledb` may briefly drop connections
- ARM may report `Ready` before `psql` is fully usable
- Apache TimescaleDB on Azure needs standard materialized views, not native continuous aggregate policies
- materialized views created with `WITH NO DATA` must be explicitly refreshed once

### 8.3 If database init still fails

Check:

```bash
psql "$DATABASE_URL" -c "SELECT version();"
```

If this fails from your machine, fix:

- proxy/TUN routing
- PG firewall
- DNS resolution

before rerunning `make azure-db-init`.

---

## 9. Step 3: Build Images

For normal deployments, prefer `make azure-all` so build, push, and deploy share one image tag. Use the split commands below only when you intentionally want to perform the steps manually.

```bash
make azure-build
```

This builds 4 images for **linux/amd64**:

- `butterfly/web` — merged Next.js + NestJS image
- `butterfly/ingestion-worker`
- `butterfly/export-worker`
- `butterfly/mosquitto`

This is required even on Apple Silicon because App Service / Container Apps / ACI all run Linux AMD64 images.

---

## 10. Step 4: Push Images to ACR

```bash
make azure-push
```

This pushes all built images to:

```text
cyberbee.azurecr.cn/butterfly/<image>:<IMAGE_TAG>
```

The deploy steps resolve each tag to an immutable `@sha256:...` digest before updating the service, so a deploy always rolls to the exact image currently behind the tag in ACR.

---

## 11. Step 5: Deploy Services

```bash
make azure-deploy-mqtt       # Mosquitto ACI
make azure-deploy-services   # Container App (two workers)
make azure-deploy-web        # Web App (merged image)
```

Or all at once:

```bash
make azure-all
```

`deploy-mqtt` notes: after first deploy, update `MQTT_URL` in `.env.azure` to the printed FQDN, then run `make azure-deploy-services` to give workers the correct broker address.

---

## 12. One-Command Deployment

After database initialization is done, you can use:

```bash
make azure-all
```

This runs in sequence:

1. `azure-build`
2. `azure-push`
3. `azure-migrate`
4. `azure-ensure-storage`
5. `azure-deploy-mqtt`
6. `azure-deploy-services`
7. `azure-deploy-web`

Use this for normal application updates.

---

## 13. Post-Deployment Verification

### 13.1 Check status

```bash
make azure-status
```

This prints Web App state, Container App latest revision, ACI container states, and public endpoints.

Expected public endpoints:

- Web App (frontend + backend): `https://cyberbee.chinacloudsites.cn`
- Health check: `https://cyberbee.chinacloudsites.cn/health`
- MQTT: `mqtt://dev-butterfly.<region>.azurecontainer.console.azure.cn:1883`

### 13.2 Check backend health

```bash
curl https://cyberbee.chinacloudsites.cn/health
```

### 13.3 Check logs

```bash
make azure-logs-web
make azure-logs-services CONTAINER=ingestion-worker
make azure-logs-services CONTAINER=export-worker
make azure-logs-mqtt
```

### 13.4 Verify first login

Use the initial admin credentials from `.env.azure`:

- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

---

## 14. Common Operational Tasks

### 14.1 View status

```bash
make azure-status
```

### 14.2 View logs

```bash
make azure-logs-web
make azure-logs-services CONTAINER=ingestion-worker
```

### 14.3 Redeploy after code changes

```bash
git pull
make azure-all
```

### 14.4 Reinitialize database policies / aggregates

If you changed SQL init logic or need to repair aggregate views:

```bash
make azure-db-init
```

This operation is intended to be idempotent.

---

## 15. Updating Configuration

### 15.1 Runtime variables

If you change values in `.env.azure` that are passed to containers at runtime, redeploy the affected service:

```bash
make azure-deploy-web        # Web App settings
make azure-deploy-services   # Container App env vars
```

### 15.2 BACKEND_ORIGIN

In the merged `butterfly/web` image, `BACKEND_ORIGIN` is always `http://127.0.0.1:3001` (set by the PID-1 entrypoint). Changing it requires rebuilding and redeploying the `web` image.

---

## 16. Troubleshooting

### 16.1 `make azure-login` fails

Check:

```bash
az cloud show --query name -o tsv
```

Expected:

```text
AzureChinaCloud
```

If not:

```bash
az cloud set --name AzureChinaCloud
```

### 16.2 `make azure-db-init` cannot connect to PostgreSQL

Check DNS:

```bash
nslookup <pg-server>.postgres.database.chinacloudapi.cn
```

If you see fake-IP style addresses like `198.18.x.x`, your proxy/TUN is still intercepting the connection.

Check connectivity:

```bash
psql "$DATABASE_URL" -c "SELECT 1;"
```

Fixes:

1. disable proxy/TUN temporarily
2. add direct rule for `chinacloudapi.cn`
3. allow your current public IP in the PG firewall

### 16.3 `make azure-db-init` pauses at PostgreSQL restart

This can happen because Azure PG may:

- report `Ready` before SQL connections are fully stable
- take additional time to accept `psql`

The script already retries this path. If it still fails:

1. wait a little longer
2. manually verify:

```bash
psql "$DATABASE_URL" -c "SHOW shared_preload_libraries;"
```

3. rerun:

```bash
make azure-db-init
```

### 16.4 Historical current-data queries fail for non-raw resolution

If you ever see an error like:

```text
materialized view "current_1m" has not been populated
```

rerun:

```bash
make azure-db-init
```

The current version of the repo explicitly refreshes Azure materialized views during initialization.

### 16.5 Images fail to pull from ACR

Check:

- `ACR_NAME`
- `ACR_LOGIN_SERVER`
- ACR credentials fetched by `az acr credential show`
- image tags pushed successfully

For Azure China, login server should end with:

```text
.azurecr.cn
```

### 16.6 Web App or workers fail after deploy

Inspect logs:

```bash
make azure-logs-web
make azure-logs-services CONTAINER=ingestion-worker
make azure-logs-services CONTAINER=export-worker
```

Pay special attention to:

- `DATABASE_URL`
- `JWT_SECRET`
- MQTT credentials and `MQTT_URL`
- Redis connection (TLS port 6380, password)
- mounted Azure File Share at `/app/exports`

### 16.7 Export files are not downloadable

Both the Web App backend and `export-worker` must mount the same Azure File Share at `/app/exports`.

Run `make azure-ensure-storage` to (re-)create the binding and mounts idempotently, then verify:

- `AZURE_STORAGE_ACCOUNT`
- `AZURE_FILE_SHARE_NAME`
- Web App storage account configuration in Azure Portal
- Container Apps environment storage binding

---

## 17. Security Checklist

Before using this deployment in production:

- Change all placeholder secrets
- Restrict PostgreSQL firewall to the smallest possible IP range
- Do not leave "allow all public IPs" enabled
- Keep ACR private; do not enable anonymous pull
- Keep Redis and PostgreSQL private (no public endpoints)
- Web App HTTPS-only is enforced by `deploy-web`; verify in Azure Portal
- Rotate admin password after first login if needed
- Rotate MQTT credentials before device rollout
- Prefer storing long-lived secrets in a secure secret-management process outside plaintext files when possible

---

## 18. Recommended Day-1 Checklist

For a brand-new Azure China environment:

1. Create required Azure resources (ACR, Web App, Container App, ACI, Redis, Storage, PostgreSQL)
2. Copy `.env.azure.example` to `.env.azure`
3. Fill all Azure names, connection strings, and secrets
4. Verify PostgreSQL firewall allows your current public IP
5. Disable proxy/TUN or configure direct routing for Azure PostgreSQL if necessary
6. Run `make azure-login`
7. Run `make azure-db-init`
8. Run `make azure-all`
9. After first `deploy-mqtt`, update `MQTT_URL` in `.env.azure` and run `make azure-deploy-services`
10. Run `make azure-status`
11. Open `https://cyberbee.chinacloudsites.cn` and log in with initial admin account
12. Publish a test MQTT message and verify ingestion

---

## 19. Useful Commands Reference

```bash
# Login
make azure-login

# Init Azure PostgreSQL
make azure-db-init

# Build images
make azure-build

# Push images
make azure-push

# Full deployment
make azure-all

# Individual service deploys
make azure-deploy-mqtt
make azure-deploy-services
make azure-deploy-web

# View status and endpoints
make azure-status

# View logs
make azure-logs-web
make azure-logs-services CONTAINER=ingestion-worker
make azure-logs-mqtt

# Ensure File Share and mounts (idempotent)
make azure-ensure-storage
```
