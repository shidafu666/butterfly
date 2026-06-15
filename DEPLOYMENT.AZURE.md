# Butterfly Azure China Deployment Guide

This document covers deploying Butterfly to **Azure China (21Vianet)** using:

- **Azure Container Registry (ACR)** for images
- **Azure Container Instances (ACI)** for runtime
- **Azure Database for PostgreSQL Flexible Server** for the database
- **Azure Storage File Share** for exported files

This guide is for the repository's existing Azure deployment flow based on:

- `.env.aci`
- `scripts/deploy-aci.sh`
- `scripts/init-azure-db.sh`
- `infra/aci/deploy.yaml.tpl`

For local Docker Compose deployment, see `DEPLOYMENT.md`.

---

## 1. Deployment Architecture

The Azure China deployment runs all app containers inside a single ACI container group:

| Container          | Purpose                      | Publicly exposed |
| ------------------ | ---------------------------- | ---------------- |
| `frontend`         | Next.js UI                   | Yes, port `3000` |
| `backend`          | NestJS API                   | Yes, port `3001` |
| `mosquitto`        | MQTT broker                  | Yes, port `1883` |
| `ingestion-worker` | MQTT -> PostgreSQL ingestion | No               |
| `export-worker`    | Async export jobs            | No               |
| `redis`            | BullMQ backing store         | No               |

Other Azure resources:

| Resource                         | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| Azure PostgreSQL Flexible Server | Application database                              |
| Azure Storage File Share         | Shared export directory for backend/export-worker |
| ACR                              | Stores container images                           |

Notes:

- PostgreSQL and Redis are **not** exposed from ACI.
- Export files are shared through Azure File Share.
- Frontend build-time variables are injected during image build, so changing `NEXT_PUBLIC_*` values requires a rebuild.

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

`make aci-login` already does this.

### 4.2 PostgreSQL firewall must allow your current public IP

`make aci-db-init` connects from **your machine** to Azure PostgreSQL. The PG firewall must allow your current public IP.

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

1. Temporarily disable proxy/TUN while running `make aci-db-init`
2. Or add a direct/bypass rule for:
   - `DOMAIN-SUFFIX,chinacloudapi.cn,DIRECT`
   - or the PG server IP / hostname
3. Ensure the PG firewall allows your current public IP

Before running `make aci-db-init`, verify DNS and connectivity:

```bash
nslookup <pg-server>.postgres.database.chinacloudapi.cn
psql "$DATABASE_URL" -c "SELECT version();"
```

If DNS resolves to `198.18.x.x`, your proxy bypass is not effective yet.

---

## 5. Azure Environment File

Copy the template:

```bash
cp .env.aci.example .env.aci
```

Then fill in real values.

Key variables:

| Variable                          | Description                         |
| --------------------------------- | ----------------------------------- |
| `AZURE_SUBSCRIPTION_ID`           | Azure China subscription ID         |
| `AZURE_RESOURCE_GROUP`            | Resource group name                 |
| `AZURE_LOCATION`                  | Region, e.g. `chinaeast2`           |
| `ACR_NAME`                        | ACR resource name                   |
| `ACR_LOGIN_SERVER`                | Usually `<acr-name>.azurecr.cn`     |
| `AZURE_STORAGE_ACCOUNT`           | Storage account used for file share |
| `AZURE_STORAGE_KEY`               | Storage account key                 |
| `AZURE_FILE_SHARE_NAME`           | File share name for exports         |
| `PG_SERVER_NAME`                  | PostgreSQL Flexible Server name     |
| `DATABASE_URL`                    | Full PostgreSQL connection string   |
| `ACI_CONTAINER_GROUP_NAME`        | ACI container group name            |
| `ACI_DNS_LABEL`                   | Public DNS label used by ACI        |
| `NEXT_PUBLIC_API_BASE_URL`        | Browser-facing backend URL          |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | MQTT credentials                    |
| `JWT_SECRET`                      | Backend JWT signing secret          |
| `INITIAL_ADMIN_*`                 | Initial admin bootstrap account     |

Important details:

### 5.1 `DATABASE_URL`

Use Azure PostgreSQL hostname and keep `sslmode=require`:

```env
DATABASE_URL="postgresql://<user>:<password>@<server>.postgres.database.chinacloudapi.cn:5432/postgres?sslmode=require"
```

If the password contains special characters, keep the whole value quoted.

### 5.2 `NEXT_PUBLIC_API_BASE_URL`

The frontend needs the backend public URL at **build time**.

Use:

```env
NEXT_PUBLIC_API_BASE_URL=http://<aci-dns-label>.<location>.azurecontainer.console.azure.cn:3001
```

Example:

```env
NEXT_PUBLIC_API_BASE_URL=http://butterfly.chinaeast2.azurecontainer.console.azure.cn:3001
```

If you change this later, rebuild and redeploy the frontend by rerunning `make aci-all`.

### 5.3 Secrets

At minimum, replace all placeholders for:

- `MQTT_PASSWORD`
- `JWT_SECRET`
- `INITIAL_ADMIN_PASSWORD`
- `AZURE_STORAGE_KEY`
- DB password inside `DATABASE_URL`

Generate a strong JWT secret:

```bash
openssl rand -hex 64
```

---

## 6. Deployment Workflow

The intended flow is:

```bash
make aci-login
make aci-db-init
make aci-all
make aci-status
```

`make aci-all` runs build, push, migration, and ACI deployment in one script
process so every step uses the same immutable image tag. The tag defaults to
the current git SHA; if the worktree is dirty, a timestamp suffix is added so
ACI rolls to a new digest. To pin a release tag explicitly, pass it on the
command line:

```bash
IMAGE_TAG=my-release make aci-all
```

Detailed steps below.

---

## 7. Step 1: Login to Azure China and ACR

```bash
make aci-login
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
make aci-db-init
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

Without `make aci-db-init`:

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

before rerunning `make aci-db-init`.

---

## 9. Step 3: Build Images

For normal deployments, prefer `make aci-all` so build, push, and deploy share
one image tag. Use the split commands below only when you intentionally want to
perform the steps manually.

```bash
make aci-build
```

This builds all app images for **linux/amd64**:

- backend
- frontend
- ingestion-worker
- export-worker
- mosquitto
- redis (pull + retag)

This is required even on Apple Silicon because ACI runs Linux AMD64 images.

---

## 10. Step 4: Push Images to ACR

```bash
make aci-push
```

This pushes all built images to:

```text
${ACR_LOGIN_SERVER}/butterfly/<image>:${IMAGE_TAG}
```

The deployment template resolves this tag to an immutable `@sha256:...` digest
before submitting to ACI. Avoid `IMAGE_TAG=latest`; a mutable tag makes it
harder to audit what code is running.

Example login server:

```text
myregistry.azurecr.cn
```

---

## 11. Step 5: Deploy to ACI

```bash
make aci-deploy
```

This does two things:

1. Generates `infra/aci/deploy.yaml` from `infra/aci/deploy.yaml.tpl`
2. Runs `az container create --file infra/aci/deploy.yaml`

The generated deployment includes:

- public IP + DNS label
- ACR image credentials
- Azure File Share mount
- all six containers
- environment variables from `.env.aci`

You usually do not edit `infra/aci/deploy.yaml` directly. Edit:

- `.env.aci`
- `infra/aci/deploy.yaml.tpl`

then redeploy.

---

## 12. One-Command Deployment

After database initialization is done, you can use:

```bash
make aci-all
```

This runs:

1. `make aci-build`
2. `make aci-push`
3. `make aci-deploy`

Use this for normal application updates.

---

## 13. Post-Deployment Verification

### 13.1 Check ACI status

```bash
make aci-status
```

This prints:

- container group status
- each container state
- public endpoints

Expected public endpoints:

- Frontend: `http://<fqdn>:3000`
- Backend: `http://<fqdn>:3001`
- MQTT: `mqtt://<fqdn>:1883`

### 13.2 Check backend health

```bash
curl http://<fqdn>:3001/health
```

### 13.3 Check container logs

```bash
make aci-logs CONTAINER=backend
make aci-logs CONTAINER=frontend
make aci-logs CONTAINER=ingestion-worker
make aci-logs CONTAINER=export-worker
make aci-logs CONTAINER=mosquitto
make aci-logs CONTAINER=redis
```

### 13.4 Verify first login

Use the initial admin credentials from `.env.aci`:

- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

---

## 14. Common Operational Tasks

### 14.1 View status

```bash
make aci-status
```

### 14.2 View logs

```bash
make aci-logs CONTAINER=backend
```

### 14.3 Redeploy after code changes

```bash
git checkout aci
git pull
make aci-all
```

### 14.4 Delete the container group

```bash
make aci-delete
```

This removes the ACI container group only. It does **not** delete:

- ACR images
- PostgreSQL data
- Azure File Share data

### 14.5 Reinitialize database policies / aggregates

If you changed SQL init logic or need to repair aggregate views:

```bash
make aci-db-init
```

This operation is intended to be idempotent.

---

## 15. Updating Configuration

### 15.1 Runtime variables

If you change values in `.env.aci` that are passed to containers at runtime, redeploy:

```bash
make aci-deploy
```

### 15.2 Frontend `NEXT_PUBLIC_*` variables

If you change any frontend build-time variables, especially:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_ENTRA_CLIENT_ID`
- `NEXT_PUBLIC_ENTRA_TENANT_ID`
- `NEXT_PUBLIC_ENTRA_REDIRECT_URI`

you must rebuild and repush:

```bash
make aci-all
```

---

## 16. Troubleshooting

### 16.1 `make aci-login` fails

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

### 16.2 `make aci-db-init` cannot connect to PostgreSQL

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

### 16.3 `make aci-db-init` pauses at PostgreSQL restart

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
make aci-db-init
```

### 16.4 Historical current-data queries fail for non-raw resolution

If you ever see an error like:

```text
materialized view "current_1m" has not been populated
```

rerun:

```bash
make aci-db-init
```

The current version of the repo explicitly refreshes Azure materialized views during initialization.

### 16.5 ACI deploy succeeds but frontend points to the wrong backend URL

Check:

```env
NEXT_PUBLIC_API_BASE_URL
```

Then rebuild and redeploy:

```bash
make aci-all
```

### 16.6 Images fail to pull from ACR

Check:

- `ACR_NAME`
- `ACR_LOGIN_SERVER`
- ACR credentials fetched by `az acr credential show`
- image tags pushed successfully

For Azure China, login server should end with:

```text
.azurecr.cn
```

### 16.7 Backend or workers fail after deploy

Inspect logs:

```bash
make aci-logs CONTAINER=backend
make aci-logs CONTAINER=ingestion-worker
make aci-logs CONTAINER=export-worker
```

Pay special attention to:

- `DATABASE_URL`
- `JWT_SECRET`
- MQTT credentials
- Redis connection
- mounted Azure File Share

### 16.8 Export files are not downloadable

Both `backend` and `export-worker` must mount the same Azure File Share path:

```text
/app/exports
```

If export jobs complete but downloads fail, verify:

- `AZURE_STORAGE_ACCOUNT`
- `AZURE_STORAGE_KEY`
- `AZURE_FILE_SHARE_NAME`
- ACI volume mount configuration

---

## 17. Security Checklist

Before using this deployment in production:

- Change all placeholder secrets
- Restrict PostgreSQL firewall to the smallest possible IP range
- Do not leave "allow all public IPs" enabled
- Keep ACR private; do not enable anonymous pull
- Keep Redis and PostgreSQL private
- Review ACI public exposure; currently only `3000`, `3001`, and `1883` are public
- Rotate admin password after first login if needed
- Rotate MQTT credentials before device rollout
- Prefer storing long-lived secrets in a secure secret-management process outside plaintext files when possible

---

## 18. Recommended Day-1 Checklist

For a brand-new Azure China environment:

1. Create required Azure resources
2. Copy `.env.aci.example` to `.env.aci`
3. Fill all Azure names, connection strings, and secrets
4. Verify PostgreSQL firewall allows your current public IP
5. Disable proxy/TUN or configure direct routing for Azure PostgreSQL if necessary
6. Run `make aci-login`
7. Run `make aci-db-init`
8. Run `make aci-all`
9. Run `make aci-status`
10. Open frontend and backend health endpoints
11. Log in with initial admin account
12. Publish a test MQTT message and verify ingestion

---

## 19. Useful Commands Reference

```bash
# Login
make aci-login

# Init Azure PostgreSQL
make aci-db-init

# Build images
make aci-build

# Push images
make aci-push

# Deploy ACI
make aci-deploy

# Build + push + deploy
make aci-all

# View status and endpoints
make aci-status

# View logs
make aci-logs CONTAINER=backend

# Delete ACI container group
make aci-delete
```
