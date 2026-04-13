# 电流数据采集与可视化平台

## 技术设计文档 V1（Sensor 命名版）

---

## 1. 文档信息

- 项目名称：电流数据采集与可视化平台
- 版本：V1.0
- 目标：指导研发实现可通过 `docker compose up -d` 一键启动的完整应用
- 设计原则：职责拆分清晰、接入链路稳定、查询与导出可扩展、权限边界明确

### 1.1 技术方向

- 前端：Next.js + TypeScript + Ant Design + ECharts
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL + TimescaleDB
- 消息接入：Mosquitto + MQTT + MessagePack
- 鉴权：Microsoft Entra ID SSO
- 导出任务：Redis + BullMQ
- 部署方式：Docker Compose

---

## 2. 系统目标与范围

### 2.1 系统目标

系统用于接收终端设备通过 MQTT 上报的电流 RMS 数据，完成秒级展开、时序存储、趋势查询、统计汇总、异步导出，以及基于 Entra ID 的单点登录和权限控制。

### 2.2 核心功能

1. 订阅 MQTT Topic `wlpca/+/data`
2. 解码 MessagePack 负载
3. 将 `devices[].deviceData.rms` 展开为秒级时序点位
4. 批量写入 PostgreSQL / TimescaleDB
5. 提供按 `sensorSn`、`deviceId`、时间范围的查询接口
6. 提供摘要统计接口
7. 提供 CSV / log 异步导出能力
8. 支持 Entra ID 单点登录
9. 支持基于角色和传感器范围的权限控制
10. 提供审计日志和导出任务记录

### 2.3 非目标

当前版本不包括：

- 多租户
- 告警引擎
- WebSocket 实时推送
- AI 异常检测
- 复杂 BI 报表

---

## 3. 输入协议与数据解释

### 3.1 MQTT 协议

- Broker：Mosquitto
- 协议：MQTT
- 订阅主题：`wlpca/+/data`

示例：

```text
wlpca/SN123456/data
```

其中 `SN123456` 对应 `sensor_sn`。

### 3.2 Payload 编码

- 编码格式：MessagePack
- 推荐解码库：`msgpackr`
- 备选：`@msgpack/msgpack`

### 3.3 Payload 结构

```json
{
  "msgId": "abc-001",
  "sn": "SN123456",
  "devices": [
    {
      "deviceId": "slave1",
      "deviceData": {
        "timestamp": 1710000000,
        "rms": [0.11, 0.12, 0.1]
      }
    }
  ]
}
```

### 3.4 数据解释规则

- `sn` 映射为 `sensor_sn`
- `devices[].deviceId` 映射为 `device_id`
- `devices[].deviceData.timestamp` 为秒级序列起点
- `devices[].deviceData.rms[i]` 对应 `timestamp + i` 时刻的电流值

展开示例：

```json
{
  "timestamp": 1710000000,
  "rms": [0.11, 0.12, 0.1]
}
```

对应展开结果：

| sensor_sn | device_id | ts         | current_value |
| --------- | --------- | ---------- | ------------- |
| SN123456  | slave1    | 1710000000 | 0.11          |
| SN123456  | slave1    | 1710000001 | 0.12          |
| SN123456  | slave1    | 1710000002 | 0.10          |

---

## 4. 总体架构

### 4.1 架构图

```text
+--------------------------+
| Frontend (Next.js)       |
| Ant Design + ECharts     |
+------------+-------------+
             |
             | HTTPS REST API
             v
+--------------------------+
| Backend API (NestJS)     |
| - Auth                   |
| - Sensor Query           |
| - Device Query           |
| - Current Data API       |
| - Export API             |
| - Admin API              |
+------------+-------------+
             |
             | DB / Redis
   +---------+----------+
   |                    |
   v                    v
+--------+        +-------------+
|Postgres|        | Redis/BullMQ|
|Timescale|       | Export Jobs |
+--------+        +-------------+
   ^
   |
   | Batch insert
   |
+--------------------------+
| Ingestion Worker         |
| - MQTT subscribe         |
| - MessagePack decode     |
| - RMS expand             |
+------------+-------------+
             |
             | MQTT
             v
+--------------------------+
| Mosquitto Broker         |
+--------------------------+
```

### 4.2 服务拆分

Docker Compose 中建议拆分以下容器：

1. `frontend`
2. `backend`
3. `ingestion-worker`
4. `export-worker`
5. `postgres`
6. `redis`
7. `mosquitto`

拆分理由：

- `backend` 面向 API 请求
- `ingestion-worker` 专注 MQTT 接入和批量入库
- `export-worker` 专注大批量导出任务
- 独立职责更利于稳定性、扩容和故障隔离

### 4.3 仓库结构

采用 monorepo，使用 pnpm workspaces：

```bash
project-root/
  apps/
    frontend/           # Next.js 14
    backend/            # NestJS + Prisma
    ingestion-worker/   # 轻量 Node.js MQTT 消费者
    export-worker/      # BullMQ 导出消费者
  packages/
    shared-types/       # 前后端共享 TypeScript 类型
    tsconfig/           # 共享 tsconfig 基础配置
  infra/
    docker/
      mosquitto/
        mosquitto.conf
      postgres/
        init/
          001_init_extensions.sql
          002_schema.sql
          003_seed.sql
          004_continuous_aggregates.sql
          005_policies.sql
  scripts/
    test-mqtt.js        # 发送测试 MessagePack MQTT 消息的脚本
  data/
    postgres/           # 数据库持久化目录（gitignore）
    exports/            # 导出文件目录（gitignore）
  .env.example
  .npmrc                # node-linker=hoisted（Docker 多阶段构建兼容性必需）
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  README.md
```

包管理：`pnpm`，在 `.npmrc` 中配置 `node-linker=hoisted`（扁平 node_modules，避免 Docker 多阶段构建中符号链接失效）。

---

## 5. 模块设计

### 5.1 Frontend

技术栈：

- Next.js 14+
- React
- TypeScript
- Ant Design
- Apache ECharts
- MSAL React
- TanStack Query

页面模块：

1. 登录页
2. 仪表盘页
3. 电流查询页
4. 导出记录页
5. 用户权限管理页
6. 审计日志页

目录建议：

```bash
apps/frontend/src/
  app/
  components/
  features/
    auth/
    current-data/
    sensors/
    devices/
    exports/
    admin/
  services/
  hooks/
  lib/
  styles/
```

### 5.2 Backend

技术栈：

- NestJS
- Prisma
- Passport / JWT 校验
- BullMQ
- Redis

模块划分：

```bash
apps/backend/src/modules/
  auth/
  users/
  sensors/
  devices/
  current-data/
  exports/
  admin/
  audit/
```

### 5.3 Ingestion Worker

技术栈：

- Node.js + TypeScript
- NestJS 或轻量独立 Node Worker
- mqtt.js
- msgpackr
- pg / Prisma

职责：

- 连接 Mosquitto
- 订阅 Topic
- MessagePack 解码
- Topic 与 payload 校验
- 数据展开
- 批量写入数据库
- 错误记录
- 自动发现 sensor / device

目录建议：

```bash
apps/ingestion-worker/src/
  mqtt/
  decoder/
  validator/
  writer/
  logger/
  main.ts
```

### 5.4 Export Worker

职责：

- 监听导出队列
- 读取导出任务
- 从数据库分页读取数据
- 生成 CSV / log 文件
- 写入共享目录或对象存储
- 更新任务状态

目录建议：

```bash
apps/export-worker/src/
  queue/
  exporters/
  storage/
  jobs/
  main.ts
```

---

## 6. 数据库设计

### 6.1 扩展要求

数据库初始化时必须启用：

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 6.2 业务表

#### 6.2.1 users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid VARCHAR(128) UNIQUE,          -- nullable: local users have no Entra OID
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255),             -- bcrypt hash; NULL for SSO-only users
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> **实现变更**：原设计 `entra_oid NOT NULL`，实现中改为 nullable，以支持本地用户名密码登录。同时增加 `password_hash` 列存储 bcrypt 哈希。

#### 6.2.2 roles

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

初始化角色：`admin`、`operator`、`viewer`、`auditor`。

#### 6.2.3 user_roles

```sql
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
```

#### 6.2.4 sensors

```sql
CREATE TABLE sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_sn VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 6.2.5 devices

```sql
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sensor_id, device_id)
);
```

#### 6.2.6 user_sensor_permissions

MVP 按 `sensor` 维度授权。

```sql
CREATE TABLE user_sensor_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_id UUID NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_export BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sensor_id)
);
```

#### 6.2.7 raw_current_measurements

原始秒级时序表：

```sql
CREATE TABLE raw_current_measurements (
  id BIGSERIAL,
  sensor_sn VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  current_value DOUBLE PRECISION NOT NULL,
  msg_id VARCHAR(128),
  source_topic VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts)
);
```

创建 hypertable：

```sql
SELECT create_hypertable('raw_current_measurements', 'ts', if_not_exists => TRUE);
```

索引：

```sql
CREATE INDEX idx_raw_current_sensor_device_ts
ON raw_current_measurements (sensor_sn, device_id, ts DESC);

CREATE INDEX idx_raw_current_sensor_ts
ON raw_current_measurements (sensor_sn, ts DESC);

CREATE INDEX idx_raw_current_ts
ON raw_current_measurements (ts DESC);
```

#### 6.2.8 ingestion_messages

```sql
CREATE TABLE ingestion_messages (
  id BIGSERIAL PRIMARY KEY,
  msg_id VARCHAR(128),
  sensor_sn VARCHAR(64),
  topic VARCHAR(255) NOT NULL,
  payload_size INT NOT NULL,
  device_count INT NOT NULL DEFAULT 0,
  point_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
```

#### 6.2.9 ingestion_error_logs

```sql
CREATE TABLE ingestion_error_logs (
  id BIGSERIAL PRIMARY KEY,
  topic VARCHAR(255) NOT NULL,
  error_type VARCHAR(64),
  error_message TEXT,
  raw_payload_base64 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 6.2.10 export_jobs

```sql
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_sn VARCHAR(64) NOT NULL,
  device_id VARCHAR(64),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  resolution VARCHAR(16) NOT NULL,
  format VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  file_path TEXT,
  file_name VARCHAR(255),
  file_size BIGINT,
  row_count BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

#### 6.2.11 audit_logs

```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64),
  resource_id VARCHAR(128),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.3 连续聚合

#### 6.3.1 1 分钟聚合

```sql
CREATE MATERIALIZED VIEW current_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value) AS avg_current,
  MIN(current_value) AS min_current,
  MAX(current_value) AS max_current,
  COUNT(*) AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id;
```

#### 6.3.2 1 小时聚合

```sql
CREATE MATERIALIZED VIEW current_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value) AS avg_current,
  MIN(current_value) AS min_current,
  MAX(current_value) AS max_current,
  COUNT(*) AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id;
```

### 6.4 刷新、保留与压缩

聚合刷新策略：

```sql
SELECT add_continuous_aggregate_policy('current_1m',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('current_1h',
  start_offset => INTERVAL '90 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
```

保留和压缩策略：

```sql
SELECT add_retention_policy('raw_current_measurements', INTERVAL '90 days');

ALTER TABLE raw_current_measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'sensor_sn,device_id'
);

SELECT add_compression_policy('raw_current_measurements', INTERVAL '7 days');
```

开发阶段如需便于排障，可先关闭压缩和 retention，生产环境开启。

---

## 7. 核心流程设计

### 7.1 数据接入流程

MQTT 接入处理流程：

```text
1. 收到 MQTT 消息
2. 校验 Topic 是否匹配
3. 解析 Topic 中 sensor_sn
4. 解码 MessagePack
5. 校验 payload 结构
6. 校验 payload.sn 与 topic sensor_sn
7. 遍历 devices 数组
8. 展开每个 device 的 rms 为秒级点位
9. 分批写入 raw_current_measurements
10. 更新 ingestion_messages
11. 失败时写入 ingestion_error_logs
```

订阅配置建议：

- Topic：`wlpca/+/data`
- QoS：建议 1
- ClientId：`current-platform-ingestion-worker`

Payload 校验要求：

- `sn` 为非空字符串
- `devices` 为数组
- `devices[].deviceId` 为非空字符串
- `devices[].deviceData.timestamp` 为有效 Unix 秒
- `devices[].deviceData.rms` 为数字数组

非法场景包括：

- MessagePack 解码失败
- payload 缺字段
- `rms` 不是数组
- `rms` 元素含非数字
- topic 中 sensor SN 与 payload.sn 不一致

处理策略：

- 记录错误日志
- 当前消息标记失败
- 不影响后续消息消费
- 连接异常时支持自动重连

批量入库建议：

- 每条 MQTT 消息展开为 `rows` 数组后单次 bulk insert
- 若数据量过大，按 1000 到 5000 条分批写入
- 推荐 `pg` 原生批量写入，或 Prisma + `$executeRaw`
- 不建议逐条 Prisma `create`

伪代码：

```ts
for each mqttMessage:
  sensorSn = parseTopic(topic)
  payload = decodeMessagePack(buffer)
  validate(payload)

  rows = []
  for device in payload.devices:
    baseTs = device.deviceData.timestamp
    rms = device.deviceData.rms

    for i in range(rms.length):
      rows.push({
        sensor_sn: payload.sn,
        device_id: device.deviceId,
        ts: new Date((baseTs + i) * 1000),
        current_value: rms[i],
        msg_id: payload.msgId,
        source_topic: topic
      })

  insert rows by batch
```

### 7.2 查询服务

默认 `resolution=auto`，自动粒度选择策略：

- `<= 6 小时`：查询 `raw_current_measurements`
- `> 6 小时 && <= 7 天`：查询 `current_1m`
- `> 7 天`：查询 `current_1h`

查询前必须校验当前用户是否具备该 `sensorSn` 的 `can_view=true` 权限。

### 7.3 导出服务

采用异步导出，流程如下：

```text
1. 前端提交导出请求
2. 后端创建 export_jobs 记录
3. 写入 BullMQ 队列
4. export-worker 消费任务
5. 分页查询数据库
6. 生成 csv 或 log 文件
7. 写入共享目录 /exports
8. 更新 export_jobs 状态
9. 前端轮询查看状态并下载
```

导出限制：

- `raw`：最多 3 天
- `1m`：最多 90 天
- `1h`：最多 1 年

目录挂载：

```bash
./data/exports:/app/exports
```

命名规则：

```text
export_{jobId}_{sensorSn}_{deviceId}_{resolution}.{ext}
```

CSV 示例：

```csv
sensor_sn,device_id,timestamp,current_value
SN123456,slave1,2026-04-13T10:15:30Z,0.11
```

```csv
sensor_sn,device_id,bucket,avg_current,min_current,max_current,sample_count
SN123456,slave1,2026-04-13T10:15:00Z,0.12,0.10,0.14,60
```

log 示例：

```log
[2026-04-13T10:15:30Z] sensor=SN123456 device=slave1 current=0.11A
```

```log
[2026-04-13T10:15:00Z] sensor=SN123456 device=slave1 avg=0.12A min=0.10A max=0.14A samples=60
```

### 7.4 鉴权与权限

Entra ID 登录流程：

- 前端通过 MSAL 登录
- 获取 Access Token 后，以 `Authorization: Bearer <token>` 调用后端
- 后端验证 `issuer`、`audience`、`signature`、`exp`
- 推荐通过 NestJS Guard 实现统一校验

用户同步策略：

- 用户首次登录时，根据 token 中的 `oid`、`email`、`name` 自动 upsert 到 `users` 表

RBAC 角色：

- `admin`：全部管理
- `operator`：查看和导出已授权传感器
- `viewer`：仅查看已授权传感器
- `auditor`：查看审计与导出日志

用户名和密码登陆：
- 第一次 set up 应用时，应支持用户设置初始用户名和密码，默认为 admin 角色
- 除了 Entra ID SSO 登陆，也同时保留用户名密码登陆的功能
- 支持管理员在应用内创建用户

MVP 按 `sensor_sn` 维度授权。

### 7.5 审计与错误处理

建议记录的审计事件：

- 登录成功
- 查询电流数据
- 创建导出任务
- 下载导出文件
- 分配角色
- 分配传感器权限

统一 API 错误格式：

```json
{
  "code": "FORBIDDEN",
  "message": "No permission for this sensor",
  "requestId": "xxxx"
}
```

日志建议使用结构化输出，如 `pino` 或 `nestjs-pino`，关键字段包括：

- `level`
- `service`
- `traceId`
- `userId`
- `sensorSn`
- `message`

---

## 8. API 设计

### 8.1 认证相关

```http
GET /api/v1/me
```

返回当前用户信息。

### 8.2 传感器与设备

```http
GET /api/v1/sensors
GET /api/v1/sensors/:sensorSn/devices
```

分别返回当前用户可见传感器列表，以及指定传感器下的设备列表。

### 8.3 电流数据

```http
GET /api/v1/current-data
GET /api/v1/current-data/summary
```

统一参数：

- `sensorSn`
- `deviceId`
- `startTime`
- `endTime`
- `resolution=auto|raw|1m|1h`

说明：此处统一使用 `sensorSn`，不再使用旧命名 `gatewaySn`。

趋势接口返回示例：

```json
{
  "sensorSn": "SN123456",
  "deviceId": "slave1",
  "resolution": "1m",
  "points": [
    {
      "timestamp": "2026-04-13T10:15:00Z",
      "avgCurrent": 0.12,
      "minCurrent": 0.1,
      "maxCurrent": 0.14,
      "sampleCount": 60
    }
  ]
}
```

摘要接口返回示例：

```json
{
  "min": 0.1,
  "max": 0.14,
  "avg": 0.12,
  "count": 3600
}
```

### 8.4 导出

```http
POST /api/v1/exports
GET /api/v1/exports
GET /api/v1/exports/:jobId
GET /api/v1/exports/:jobId/download
```

请求体示例：

```json
{
  "sensorSn": "SN123456",
  "deviceId": "slave1",
  "startTime": "2026-04-13T00:00:00Z",
  "endTime": "2026-04-13T23:59:59Z",
  "resolution": "1m",
  "format": "csv"
}
```

### 8.5 管理

```http
GET /api/v1/admin/users
POST /api/v1/admin/users/:userId/roles
POST /api/v1/admin/users/:userId/sensors
GET /api/v1/admin/audit-logs
```

---

## 9. 前端设计

### 9.1 页面清单

#### 9.1.1 登录页

- SSO 登录按钮
- 登录提示文字

#### 9.1.2 首页

- 总传感器数
- 总设备数
- 今日数据点数
- 最近导出任务

#### 9.1.3 电流数据页

- Sensor 选择框
- Device 选择框
- 时间范围选择器
- 分辨率选择器
- 查询按钮
- 导出按钮
- 摘要统计卡片
- 折线图
- 明细表格

#### 9.1.4 导出任务页

- 任务列表
- 状态
- 文件格式
- 时间范围
- 下载按钮

#### 9.1.5 用户权限页

- 用户列表
- 角色分配
- 传感器授权

#### 9.1.6 审计日志页

- 日志列表
- 筛选条件

### 9.2 图表设计

使用 ECharts，要求如下：

- 原始数据使用单折线
- 聚合数据使用平均线 + 最小最大区间
- 支持 tooltip
- 支持 dataZoom
- 可选支持导出图片
- 可采用深色科技风主题

---

## 10. 部署与运维设计

### 10.1 Compose 服务清单

- `frontend`
- `backend`
- `ingestion-worker`
- `export-worker`
- `postgres`
- `redis`
- `mosquitto`

### 10.2 docker-compose 关键要求

- PostgreSQL 使用 TimescaleDB 镜像（`timescale/timescaledb:latest-pg16`）
- `postgres` 挂载数据目录和初始化 SQL 目录
- `backend`、`ingestion-worker`、`export-worker` 通过 `.env` 注入配置
- `export-worker` 挂载导出目录
- 所有关键服务建议配置 `healthcheck`
- **frontend 服务必须在 `environment` 中显式设置 `PORT: '3000'`**，防止被 `.env` 中的 `PORT=3001`（后端端口）覆盖

**Dockerfile 关键注意事项：**

- Alpine 镜像需要 `apk add --no-cache openssl`（builder 和 runner 阶段均需），以便 Prisma 正确检测 OpenSSL 3.x 并加载对应引擎二进制
- Prisma `schema.prisma` 中需声明 `binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x"]`（ARM64 机器）或 `linux-musl-openssl-3.0.x`（AMD64 机器）
- 使用 `node-linker=hoisted` 后，runner 阶段直接 `COPY /app/node_modules` 即可，无需处理 pnpm 符号链接

目录挂载重点：

```yaml
../../data/postgres:/var/lib/postgresql/data
../docker/postgres/init:/docker-entrypoint-initdb.d
../../data/exports:/app/exports
```

### 10.3 环境变量要求

```env
# postgres
POSTGRES_USER=app
POSTGRES_PASSWORD=app123
POSTGRES_DB=current_platform
DATABASE_URL=postgresql://app:app123@postgres:5432/current_platform

# redis
REDIS_HOST=redis
REDIS_PORT=6379

# mqtt
MQTT_URL=mqtt://mosquitto:1883
MQTT_TOPIC=wlpca/+/data
MQTT_CLIENT_ID=current-platform-ingestion-worker

# backend（注意：PORT=3001 仅作用于 backend，frontend 在 docker-compose 中显式覆盖为 3000）
PORT=3001
EXPORT_DIR=/app/exports
JWT_SECRET=your-jwt-secret-change-in-production

# 初始管理员（后端首次启动时自动创建，若用户表为空）
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=Admin@123456

# Entra ID（可选，留空则禁用 SSO 登录）
JWT_AUDIENCE=api://your-app-id
JWT_ISSUER=https://login.microsoftonline.com/your-tenant-id/v2.0
ENTRA_CLIENT_ID=your-client-id
ENTRA_TENANT_ID=your-tenant-id

# frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_ENTRA_CLIENT_ID=your-client-id
NEXT_PUBLIC_ENTRA_TENANT_ID=your-tenant-id
NEXT_PUBLIC_ENTRA_REDIRECT_URI=http://localhost:3000

# app
NODE_ENV=development
```

首次启动前执行：

```bash
cp .env.example .env
```

### 10.4 初始化 SQL 目录约定

路径：

```bash
infra/docker/postgres/init/
```

推荐顺序：

1. `001_init_extensions.sql`
2. `002_schema.sql`
3. `003_seed.sql`
4. `004_continuous_aggregates.sql`
5. `005_policies.sql`
6. 其他触发器或补充 SQL

说明：Postgres / Timescale 的自动初始化只会在数据库首次创建且数据目录为空时执行。

### 10.5 启动脚本建议

建议提供以下脚本：

- `scripts/up.sh`：初始化目录并启动全部服务
- `scripts/down.sh`：停止服务
- `scripts/logs.sh`：查看日志
- `scripts/reset.sh`：清空本地数据并重建环境

关键要求：

- `up.sh` 支持在 `.env` 不存在时从 `.env.example` 复制
- `reset.sh` 明确提示会删除本地数据库数据
- 启动后输出前端、后端和 Swagger 地址

### 10.6 自动初始化边界与升级策略

自动初始化 SQL 会执行的场景：

- 新机器第一次部署
- 删除 `data/postgres` 后重新启动
- 空数据卷第一次启动

不会自动执行的场景：

- 只是重启已有数据库容器
- 旧环境升级新版本
- 新增 SQL 文件后直接重启 compose

因此后续升级建议采用双轨策略：

- 普通表结构变更：使用 Prisma Migrate
- Timescale 特性对象：保留原生 SQL 管理

如后续接入 Prisma migration，可在 Compose 中增加单独的 `migrate` 服务。

### 10.7 健康检查与监控

- 每个服务建议暴露 `/health`
- Compose 中为 `postgres`、`redis`、`backend` 等关键服务配置 `healthcheck`
- `healthcheck` 可避免 `backend` 在依赖尚未就绪时提前启动报错

开发环境建议使用本地目录挂载，便于观察数据和重置环境；生产环境建议切换为 named volume。

---

## 11. 验收、交付与计划

### 11.1 验收标准

一键启动验收：

```bash
docker compose up -d
```

应满足：

- PostgreSQL 启动并自动初始化 schema
- Redis 启动
- Mosquitto 启动
- Backend 启动
- Ingestion Worker 启动
- Export Worker 启动
- Frontend 启动

基础链路验收：

1. 向 Mosquitto 发布测试 MessagePack 消息
2. ingestion-worker 自动消费
3. 秒级点位入库成功
4. 前端可查询并展示图表
5. 可发起导出任务并下载文件

权限链路验收：

1. 用户通过 Entra ID 登录
2. 后端能识别用户
3. 未授权传感器无法访问
4. 已授权传感器可正常查询和导出

### 11.2 研发交付物

研发最终需交付：

1. 完整源码
2. `docker-compose.yml`
3. `.env.example`
4. SQL 初始化脚本
5. README 启动文档
6. 测试 MQTT 发布脚本
7. 默认管理员初始化说明
8. API 文档（Swagger）
9. 前端页面截图
10. 样例导出文件

README 至少应包含：

- 本地启动方式
- 初始化说明
- 测试消息发送方式
- 前端、Swagger、健康检查地址

### 11.3 研发任务拆分

后端任务：

1. Entra ID JWT 验证
2. 用户自动同步
3. 传感器与设备 API
4. 当前数据查询 API
5. 摘要统计 API
6. 导出任务 API
7. 管理接口
8. 审计日志

Ingestion Worker 任务：

1. MQTT 连接
2. Topic 解析
3. MessagePack 解码
4. Payload 校验
5. RMS 展开
6. 批量写入
7. 错误日志
8. 自动发现 sensor / device

Export Worker 任务：

1. BullMQ 消费
2. 查询分页读取
3. CSV 输出
4. log 输出
5. 文件写盘
6. 状态更新

前端任务：

1. SSO 登录
2. 全局布局
3. 查询页
4. 图表组件
5. 导出页
6. 管理页
7. 审计页

### 11.4 MVP 开发优先级

P0：

- Docker Compose 基础环境
- 数据库初始化
- Ingestion Worker 接入 MQTT
- 数据入库
- 查询 API
- 前端查询页
- 基础图表

P1：

- Entra ID SSO
- 权限控制
- 导出任务
- 导出下载

P2：

- 审计日志
- 管理页
- 聚合优化
- UI 美化
