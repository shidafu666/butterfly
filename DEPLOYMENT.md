# Butterfly — Deployment Guide

This guide covers deploying Butterfly via Docker Compose, from first-time setup to production hardening and ongoing operations.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- 2 GB RAM minimum (4 GB recommended for production)
- Ports 3000, 3001, 1883, 5432, 6379 available on the host

---

## 1. First-Time Setup

### 1.1 Clone the repository

```bash
git clone <repo-url>
cd butterfly
```

### 1.2 Create your environment file

```bash
cp .env.example .env
```

Edit `.env` and change **all secrets** before starting (see [Section 3](#3-environment-variables)).

### 1.3 Create data directories

```bash
mkdir -p data/postgres data/exports
```

These directories are mounted into the containers and are gitignored. `data/postgres` holds the database files; `data/exports` holds generated export files.

### 1.4 Start all services

```bash
./scripts/up.sh
```

Or manually:

```bash
docker compose up -d --build
```

On first startup, Docker will build all images and initialize the database schema automatically. This takes 2–3 minutes.

### 1.5 Verify services are healthy

```bash
docker compose ps
```

All 7 services should reach `healthy` or `running` status:

| Container | Role |
|-----------|------|
| `butterfly-postgres` | TimescaleDB (PostgreSQL 16) |
| `butterfly-redis` | Job queue (BullMQ) |
| `butterfly-mosquitto` | MQTT broker |
| `butterfly-backend` | NestJS REST API |
| `butterfly-ingestion-worker` | MQTT → DB writer |
| `butterfly-export-worker` | Async CSV/log exporter |
| `butterfly-frontend` | Next.js web UI |

### 1.6 Access the application

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| Swagger Docs | http://localhost:3001/api/docs |
| Health Check | http://localhost:3001/health |
| MQTT Broker | mqtt://localhost:1883 |

### 1.7 Initial admin login

On first startup, an admin account is created from `.env`:

- **Email**: value of `INITIAL_ADMIN_EMAIL` (default: `admin@example.com`)
- **Password**: value of `INITIAL_ADMIN_PASSWORD` (default: `Admin@123456`)

Change these in `.env` before deploying to production.

---

## 2. Service Architecture

```
Internet / Sensors
        |
        | MQTT (port 1883)
        v
  ┌─────────────┐
  │  Mosquitto  │  Requires username + password (MQTT_USERNAME / MQTT_PASSWORD)
  └──────┬──────┘
         | internal
         v
  ┌──────────────────┐
  │ ingestion-worker │  Decodes MessagePack, expands RMS arrays, bulk-inserts rows
  └──────┬───────────┘
         | PostgreSQL
         v
  ┌──────────────┐       ┌───────────────┐
  │  TimescaleDB │ ←───  │ export-worker │  BullMQ consumer → writes CSV/log files
  └──────┬───────┘       └───────────────┘
         |                       ↑
         | REST API              | shared volume (./data/exports)
         v                       |
  ┌─────────────┐        ┌───────────────┐
  │   Backend   │ ──────→│    Frontend   │
  │  (NestJS)   │        │   (Next.js)   │
  └─────────────┘        └───────────────┘
         |
         | Redis (BullMQ)
         v
  ┌──────────────┐
  │    Redis     │
  └──────────────┘
```

---

## 3. Environment Variables

All variables live in `.env` (copied from `.env.example`).

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `app` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `app123` | PostgreSQL password — **change in production** |
| `POSTGRES_DB` | `current_platform` | Database name |
| `DATABASE_URL` | *(constructed)* | Full connection string; must match `POSTGRES_*` values |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `redis` | Redis hostname (Docker service name) |
| `REDIS_PORT` | `6379` | Redis port |

### MQTT

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_URL` | `mqtt://mosquitto:1883` | Internal broker URL for workers |
| `MQTT_TOPIC` | `wlpca/+/data` | Topic pattern to subscribe to |
| `MQTT_CLIENT_ID` | `current-platform-ingestion-worker` | MQTT client identifier |
| `MQTT_USERNAME` | `iot_device` | Broker auth username — **used by sensors and workers** |
| `MQTT_PASSWORD` | `change-me-mqtt-password` | Broker auth password — **change in production** |

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend listen port (do not change; frontend is explicitly set to 3000 in docker-compose) |
| `JWT_SECRET` | *(placeholder)* | HS256 signing secret — **must be changed in production** |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime |
| `EXPORT_DIR` | `/app/exports` | Container path for export files (do not change) |
| `SENSOR_ACTIVE_THRESHOLD_HOURS` | `24` | Hours since a sensor's last report before it is marked **Inactive** in the device list |
| `EXPORT_JOB_RETENTION_HOURS` | `24` | Hours before completed export jobs and their files are automatically deleted |

### Initial Admin

| Variable | Default | Description |
|----------|---------|-------------|
| `INITIAL_ADMIN_EMAIL` | `admin@example.com` | Admin email — used only on first startup if no users exist |
| `INITIAL_ADMIN_PASSWORD` | `Admin@123456` | Admin password — **change in production** |
| `INITIAL_ADMIN_NAME` | `Administrator` | Admin display name |

### Microsoft Entra ID SSO (optional)

Leave all four variables empty to disable SSO and use local auth only.

| Variable | Description |
|----------|-------------|
| `JWT_AUDIENCE` | App ID URI, e.g. `api://your-app-id` |
| `JWT_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | Azure app client ID |
| `NEXT_PUBLIC_ENTRA_TENANT_ID` | Azure tenant ID |
| `NEXT_PUBLIC_ENTRA_REDIRECT_URI` | Frontend URL, e.g. `https://your-domain.com` |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | Backend URL as seen from the **browser** — change to your public hostname in production |

---

## 4. Connecting IoT Sensors

Sensors publish MessagePack-encoded messages over MQTT.

### 4.1 Topic format

```
wlpca/<sensor_sn>/data
```

Replace `<sensor_sn>` with the sensor's serial number, e.g. `wlpca/SN123456/data`.

### 4.2 Authentication

The broker requires credentials. Use the values from your `.env`:

```
username: MQTT_USERNAME   (default: iot_device)
password: MQTT_PASSWORD   (default: change-me-mqtt-password)
```

Set these in your sensor firmware or MQTT client configuration.

### 4.3 Payload format

Encode the following structure with MessagePack before publishing:

```json
{
  "msgId": "unique-message-id",
  "sn": "SN123456",
  "devices": [
    {
      "deviceId": "slave1",
      "deviceData": {
        "timestamp": 1710000000,
        "rms": [0.11, 0.12, 0.10]
      }
    }
  ]
}
```

- `timestamp` — Unix epoch in **seconds** (start of the measurement window)
- `rms` — array of current values (A); element `i` corresponds to `timestamp + i` seconds
- Multiple devices can be included in one message

The ingestion worker auto-creates sensor and device records on first message received.

### 4.4 Test from command line

```bash
# Install test dependencies (one time)
cd scripts && npm install --save-dev mqtt msgpackr && cd ..

# Publish a test message
node scripts/test-mqtt.js mqtt://localhost:1883 SN123456 wlpca/SN123456/data <MQTT_USERNAME> <MQTT_PASSWORD>
```

---

## 5. Data Retention

### 5.1 Raw measurement data

Default policy: raw measurements are retained for **30 days**; chunks older than 7 days are compressed automatically.

### 5.2 Export job retention

Completed export jobs (and their files in `data/exports`) are automatically deleted after **24 hours** by the backend cleanup service. This keeps disk usage bounded without manual intervention. Users who need the data again can create a new export job from the **电流数据** page.

To change the retention window, set `EXPORT_JOB_RETENTION_HOURS` in `.env` before starting the backend:

```env
EXPORT_JOB_RETENTION_HOURS=48   # keep exports for 48 hours
```

### 5.3 Change raw data retention on a running instance

```bash
./scripts/set-retention.sh 60   # keep 60 days
./scripts/set-retention.sh 90   # keep 90 days
```

### 5.4 Change the default for new deployments

Edit the interval in `infra/docker/postgres/init/005_policies.sql`:

```sql
SELECT add_retention_policy('raw_current_measurements', INTERVAL '30 days');
--                                                                ^^^^^^^^^^
--                                                                change this
```

This file is only executed when the database is initialized from scratch (empty `data/postgres`).

### 5.5 Query current retention setting

```bash
docker exec butterfly-postgres psql -U app -d current_platform -c \
  "SELECT job_id, config->>'drop_after' AS retention FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';"
```

---

## 6. Day-to-Day Operations

### Start / stop

```bash
./scripts/up.sh          # start all services (builds if needed)
./scripts/down.sh        # stop all services (data is preserved)
```

### View logs

```bash
./scripts/logs.sh                  # all services
./scripts/logs.sh backend          # backend only
./scripts/logs.sh ingestion-worker # ingestion worker only
docker compose logs -f frontend    # follow frontend logs
```

### Rebuild a single service after code changes

```bash
docker compose build backend
docker compose up -d backend
```

### Health check

```bash
curl http://localhost:3001/health
```

---

## 7. Upgrading

When pulling new code:

```bash
git pull
docker compose build          # rebuild changed images
docker compose up -d          # restart changed services
```

The database schema is managed by Prisma migrations. If a release includes schema changes, the backend applies them automatically on startup.

---

## 8. Production Hardening Checklist

Before exposing to the internet or a production network:

- [ ] Change `POSTGRES_PASSWORD` to a strong random string
- [ ] Change `JWT_SECRET` to a long random string (`openssl rand -hex 64`)
- [ ] Change `MQTT_PASSWORD` to a strong random string
- [ ] Change `INITIAL_ADMIN_PASSWORD` (or create a new admin user and delete the default one)
- [ ] Set `NEXT_PUBLIC_API_BASE_URL` to your actual public backend URL
- [ ] Put a reverse proxy (nginx, Caddy, Traefik) in front of ports 3000 and 3001 with TLS
- [ ] Do **not** expose PostgreSQL (5432) or Redis (6379) to the public network
- [ ] For MQTT over the internet, use TLS (MQTT port 8883) — requires additional Mosquitto configuration
- [ ] Consider switching `data/postgres` to a named Docker volume for easier backup management

### Generate a strong JWT secret

```bash
openssl rand -hex 64
```

---

## 9. Reset / Clean Start

> **Warning:** This deletes all data including the database and export files.

```bash
./scripts/reset.sh
```

This stops all containers, removes `data/postgres` and `data/exports`, and restarts fresh. The database is re-initialized from the SQL scripts in `infra/docker/postgres/init/`.

---

## 10. Troubleshooting

### Services fail to start / stay unhealthy

Check logs for the failing service:

```bash
docker compose logs backend
docker compose logs postgres
```

Common causes:
- `data/postgres` directory missing → run `mkdir -p data/postgres data/exports`
- Port already in use → check with `lsof -i :3001` (or `:3000`, `:5432`)
- `.env` missing → copy from `.env.example`

### Backend crashes with "Prisma engine not found"

This happens on ARM64 (Apple Silicon) if the Prisma binary target is wrong. The `apps/backend/Dockerfile` already adds the correct `binaryTargets`. Rebuild the image:

```bash
docker compose build backend
```

### MQTT messages not ingested

1. Verify the broker is running: `docker compose logs mosquitto`
2. Check credentials: anonymous connections are rejected
3. Check ingestion worker logs: `docker compose logs ingestion-worker`
4. Confirm the topic matches `wlpca/+/data`

### Export download fails ("file not found")

Both `backend` and `export-worker` must mount the same export directory. Verify in `docker-compose.yml` that both services have:

```yaml
volumes:
  - ./data/exports:/app/exports
```

### Audit logs table is empty

The audit log table is populated by backend operations (login, export, role changes, etc.). Perform an action in the UI, then refresh the audit log page. Filter by action type or date range to narrow results.
