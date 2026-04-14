# Butterfly — 电流数据采集与可视化平台

A current (electrical) data collection and visualization platform built with NestJS, Next.js, TimescaleDB, MQTT, and Redis.

## Architecture

```
Frontend (Next.js)  →  Backend API (NestJS)  →  PostgreSQL/TimescaleDB
                                              →  Redis (BullMQ)

MQTT Device → Mosquitto Broker → Ingestion Worker → PostgreSQL/TimescaleDB
                                                  → Auto-discovers sensors/devices

Redis ← Export Job Queue ← Backend API
Redis → Export Worker → CSV/Log files → shared volume → Frontend download
```

## Quick Start

### Prerequisites
- Docker & Docker Compose v2+
- (For test scripts) Node.js 20+ and pnpm
- `make` (pre-installed on macOS/Linux)

### 1. Clone and Start

```bash
git clone <repo-url>
cd butterfly

# Start all services (creates .env from .env.example if missing)
make up
```

Or without make:
```bash
cp .env.example .env
# Edit .env if needed (especially passwords for production)
mkdir -p data/postgres data/exports
docker compose up -d --build
```

### 2. Access the Application

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| Swagger Docs | http://localhost:3001/api/docs |
| Health Check | http://localhost:3001/health |
| MQTT Broker | mqtt://localhost:1883 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### 3. Initial Login

On first startup, an admin user is automatically created from `.env`:
- **Email**: `admin@example.com` (or `INITIAL_ADMIN_EMAIL`)
- **Password**: `Admin@123456` (or `INITIAL_ADMIN_PASSWORD`)

### 4. Send a Test MQTT Message

Install test script dependencies, then publish a mock message:

```bash
# Install dependencies (only needed for test scripts)
cd scripts && npm install --save-dev mqtt msgpackr && cd ..

# Send a mock message
make test-mqtt

# Or directly:
node scripts/test-mqtt.js mqtt://localhost:1883 SN123456 wlpca/SN123456/data iot_device change-me-mqtt-password
```

> The MQTT broker requires authentication. Credentials are set via `MQTT_USERNAME` / `MQTT_PASSWORD` in `.env`.

This will:
1. Publish a MessagePack-encoded MQTT message to `wlpca/SN123456/data`
2. The ingestion worker will decode it and insert ~20 data points into the DB
3. The sensor `SN123456` and its devices will be auto-discovered
4. Open the frontend to see the data

## Development

### Local Development (without Docker)

```bash
make install        # install all workspace dependencies

make dev-backend    # start backend in watch mode
make dev-ingestion  # start ingestion worker
make dev-export     # start export worker
make dev-frontend   # start frontend (localhost:3000)

make typecheck      # TypeScript type-check across all packages
make lint           # run linters
make build          # build all packages and apps
```

Update `DATABASE_URL`, `MQTT_URL`, `REDIS_HOST` in `.env` to point to local services.

### Project Structure

```
butterfly/
├── apps/
│   ├── backend/          # NestJS REST API
│   ├── frontend/         # Next.js 14 App Router
│   ├── ingestion-worker/ # MQTT subscriber → TimescaleDB writer
│   └── export-worker/    # BullMQ consumer → CSV/log exporter
├── packages/
│   ├── shared-types/     # Shared TypeScript interfaces
│   └── tsconfig/         # Shared TS compiler configs
├── infra/
│   └── docker/
│       ├── mosquitto/    # Mosquitto MQTT broker config
│       └── postgres/init/ # SQL initialization scripts
├── scripts/
│   ├── up.sh             # Start all services
│   ├── down.sh           # Stop all services
│   ├── logs.sh           # View logs
│   ├── reset.sh          # Reset data and restart
│   ├── set-retention.sh  # Change raw data retention window
│   └── test-mqtt.js      # Send mock MQTT message
├── data/
│   ├── postgres/         # DB data (gitignored)
│   └── exports/          # Export files (gitignored)
├── docker-compose.yml
├── Makefile              # Convenience targets (run `make help`)
├── .env.example
└── architecture.md
```

## MQTT Message Format

Sensors publish to `wlpca/<sensorSn>/data`. The ingestion worker subscribes via an MQTT shared subscription (`$share/ingestion-workers/wlpca/+/data`) so that multiple worker replicas share the load without processing the same message twice. The sensor-side topic format is unchanged.

Expected MessagePack-encoded payload:

```json
{
  "msgId": "abc-001",
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

Each `rms[i]` corresponds to `timestamp + i` seconds. The array is expanded into individual `raw_current_measurements` rows.

## Environment Variables

See `.env.example` for all available variables.

Key variables:
- `POSTGRES_*` — database credentials
- `REDIS_*` — Redis connection
- `MQTT_URL` — broker connection URL (internal: `mqtt://mosquitto:1883`)
- `MQTT_USERNAME` / `MQTT_PASSWORD` — broker auth credentials; sensors must use these same credentials
- `JWT_SECRET` — secret for signing local JWTs (change in production!)
- `INITIAL_ADMIN_*` — initial admin account credentials (used only on first startup)
- `SENSOR_ACTIVE_THRESHOLD_HOURS` — hours since last report before a sensor is marked Inactive (default: `24`)
- `EXPORT_JOB_RETENTION_HOURS` — hours before export jobs and their files are automatically deleted (default: `24`)
- `INGESTION_CONCURRENCY` — max concurrent message handlers per ingestion worker replica (default: `10`)
- `DB_POOL_MAX` — PostgreSQL connection pool size per ingestion worker replica (default: `20`)
- `NEXT_PUBLIC_ENTRA_*` — Microsoft Entra ID SSO (optional)

## Microsoft Entra ID SSO (Optional)

To enable SSO:
1. Register an app in Azure Active Directory
2. Set in `.env`:
   ```
   JWT_AUDIENCE=api://your-app-id
   JWT_ISSUER=https://login.microsoftonline.com/your-tenant-id/v2.0
   NEXT_PUBLIC_ENTRA_CLIENT_ID=your-client-id
   NEXT_PUBLIC_ENTRA_TENANT_ID=your-tenant-id
   NEXT_PUBLIC_ENTRA_REDIRECT_URI=http://localhost:3000
   ```

Local username/password login always remains available regardless of SSO configuration.

## Common Operations

```bash
make up                       # start all services
make down                     # stop all services
make restart                  # stop then start
make rebuild                  # rebuild app images and restart (no infra restart)
make reset                    # ⚠️  wipe data directories and restart fresh

make logs                     # tail all logs
make logs-backend             # tail backend logs only
make logs-frontend            # tail frontend logs only
make logs-ingestion           # tail ingestion-worker logs
make logs-infra               # tail postgres / redis / mosquitto logs

make ps                       # show container status

make db-shell                 # open psql inside the postgres container
make set-retention DAYS=30    # set raw data retention to N days
make scale-ingestion N=3      # run N ingestion-worker replicas
make test-mqtt                # send a test MQTT message
```

Run `make help` to see all available targets.

## API Documentation

Swagger UI is available at http://localhost:3001/api/docs when running.

Key endpoints:
- `POST /api/v1/auth/login` — login with email/password
- `GET /api/v1/sensors` — list sensors
- `GET /api/v1/current-data` — query time-series data
- `POST /api/v1/exports` — create an export job
- `GET /api/v1/exports` — list export jobs (auto-cleaned after 24 h)
- `GET /api/v1/admin/users` — list users (admin only)
- `PATCH /api/v1/admin/users/:userId` — edit user email / name / password / status (admin only)
- `DELETE /api/v1/admin/users/:userId` — delete user (admin only)
- `GET /api/v1/admin/sensors` — list sensors with last-report time and active status (admin only)
- `PATCH /api/v1/admin/sensors/:sensorSn` — update sensor display name (admin only)
- `POST /api/v1/admin/users/:userId/sensors/batch` — batch-assign sensor permissions to a user (admin only)

## Data Retention

Default configuration:
- Raw data: **30-day retention** (automatically drops data older than 30 days)
- Compression: chunks older than 7 days are compressed automatically
- Continuous aggregates: refreshed every minute (1m) / every hour (1h)

To change the retention window on a running instance:

```bash
make set-retention DAYS=60   # keep 60 days
make set-retention DAYS=7    # keep 7 days
```

To change the default for fresh deployments, edit `INTERVAL '30 days'` in `infra/docker/postgres/init/005_policies.sql`.

## License

GPL-3.0