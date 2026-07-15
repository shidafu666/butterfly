# 电流数据采集与可视化平台

## 技术设计文档 V1（Sensor 命名版）

---

## 1. 文档信息

- 项目名称：电流数据采集与可视化平台（CyberBee）
- 版本：V1.1（As-Built — 反映已实现状态）
- 目标：指导研发实现可通过 `docker compose up -d` 一键启动的完整应用
- 设计原则：职责拆分清晰、接入链路稳定、查询与导出可扩展、权限边界明确
- 实现状态：**已完成并交付**

### 1.1 技术方向

- 前端：Next.js 14 App Router + TypeScript + Ant Design + ECharts
- 后端：NestJS + TypeScript + Prisma
- 数据库：PostgreSQL 16 + TimescaleDB
- 消息接入：Mosquitto + MQTT + MessagePack
- 鉴权：Microsoft Entra ID SSO（可选）+ 本地用户名密码登录
- 导出任务：Redis + BullMQ
- 部署方式：Docker Compose（本地开发 / 自托管）；Azure China 生产环境：Web App + Container App + ACI（见第 12 节）
- 国际化：简体中文 / English，运行时切换
- 主题：Light / Dark / System，浏览器级持久化

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

实际传感器固件发送的完整格式（部分字段旧固件可能缺失，解码时应宽容处理）：

```json
{
  "msgId": 1,
  "rssi": -69,
  "timestamp": 1776153610,
  "sn": "863434080879965",
  "version": "001.002.014",
  "battery": 50,
  "devices": [
    {
      "deviceId": "slave1",
      "deviceFirmware": 28,
      "deviceState": 1,
      "deviceData": {
        "timestamp": 1776150347,
        "rms": [3.1, 3.2, 3.0]
      }
    }
  ]
}
```

字段说明：

- `msgId` — 消息标识符，新固件为整数，旧固件可能为字符串；两者均接受
- `timestamp`（顶层）— 传感器发送消息时的 Unix 时间戳（秒）
- `rssi`、`version`、`battery` — 可选元数据，不参与入库
- `devices[].deviceFirmware`、`devices[].deviceState` — 可选设备状态字段，不参与入库
- `devices[].deviceData.timestamp` — 该设备 RMS 序列的第一个采样点时间戳（秒）
- `devices[].deviceData.rms` — RMS 电流值数组（单位 A）

完整参考 Payload 见 `scripts/mock-payload.json`。

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
IoT 传感器设备
      |
      | MQTT (TCP 1883)  用户名 + 密码认证
      v
+--------------------------+
| Mosquitto Broker         |
| mcr.azure.cn/devcontainers/base:bookworm + mosquitto |
| docker-entrypoint.sh 动  |
| 态生成密码文件            |
+------------+-------------+
             |
             | MQTT shared subscription
             | $share/ingestion-workers/wlpca/+/data
             v
+--------------------------+
| Ingestion Worker         |
| - MQTT 订阅              |
| - MessagePack 解码       |
| - RMS 秒级展开           |
| - 批量写入 TimescaleDB   |
| - 自动发现 sensor/device |
| （可水平扩展多副本）      |
+------------+-------------+
             |
             | Batch INSERT (ON CONFLICT DO NOTHING)
             v
+--------------------------+        +---------------------+
| PostgreSQL + TimescaleDB |<-------| Export Worker       |
| - raw_current_measurements        | - BullMQ 消费       |
| - current_1m / 1h / 1d  |        | - 分页读取          |
| - 30 天保留 + 7 天压缩   |        | - 生成 CSV / log    |
+-----------+--------------+        | - 写入共享目录      |
            |                       +----+----------------+
            | REST API                   |
            v                            | 共享挂载卷
+--------------------------+        +----+----------------+
| Backend API (NestJS)     +------->| /app/exports        |
| - Auth (JWT + Entra SSO) |        | (data/exports)      |
| - Sensor / Device API    |        +---------------------+
| - Current Data API       |
| - Export API             |
| - Admin API              |
| - Audit Logs             |
+------------+-------------+
             |
             | BullMQ (Redis)
             v
+--------------------------+
| Redis 7                  |
| - 导出任务队列           |
+--------------------------+
             ^
             |
+------------+-------------+
| Frontend (Next.js 14)    |
| - Ant Design + ECharts   |
| - 国际化 (zh/en)         |
| - Light/Dark 主题        |
| - MSAL SSO               |
+--------------------------+
             |
             | （可选）
             v
   Microsoft Entra ID SSO
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
butterfly/
  apps/
    frontend/           # Next.js 14 App Router
    backend/            # NestJS + Prisma
    ingestion-worker/   # NestJS MQTT 消费者（可水平扩展）
    export-worker/      # BullMQ 导出消费者
  packages/
    shared-types/       # 前后端共享 TypeScript 类型
    tsconfig/           # 共享 tsconfig 基础配置
  infra/
    docker/
      mosquitto/
        mosquitto.conf              # Broker 配置（关闭匿名、开启认证）
        docker-entrypoint.sh        # 启动时从环境变量动态生成密码文件
      postgres/
        init/
          001_init_extensions.sql
          002_schema.sql
          003_seed.sql
          004_continuous_aggregates.sql
          005_policies.sql
  scripts/
    up.sh               # 初始化目录并启动全部服务
    down.sh             # 停止服务
    logs.sh             # 查看日志
    reset.sh            # 清空本地数据并重建环境
    set-retention.sh    # 修改原始数据保留天数
    test-mqtt.js        # 发送测试 MessagePack MQTT 消息（3 批次，共 10800 个点）
    mock-payload.json   # 与真实传感器格式一致的参考 Payload
    package.json        # 测试脚本依赖（mqtt、msgpackr）
  data/
    postgres/           # 数据库持久化目录（gitignore）
    exports/            # 导出文件目录（gitignore）
  .env.example
  .npmrc                # node-linker=hoisted（Docker 多阶段构建兼容性必需）
  docker-compose.yml
  Makefile              # 快捷命令（run `make help` 查看全部）
  package.json
  pnpm-workspace.yaml
  README.md
  DEPLOYMENT.md
  architecture.md
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
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value) AS avg_current,
  MIN(current_value) AS min_current,
  MAX(current_value) AS max_current,
  COUNT(*) AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;
```

#### 6.3.2 1 小时聚合

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value) AS avg_current,
  MIN(current_value) AS min_current,
  MAX(current_value) AS max_current,
  COUNT(*) AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;
```

#### 6.3.3 1 天聚合

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value) AS avg_current,
  MIN(current_value) AS min_current,
  MAX(current_value) AS max_current,
  COUNT(*) AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;
```

### 6.4 刷新、保留与压缩

聚合刷新策略：

```sql
SELECT add_continuous_aggregate_policy('current_1m',
  start_offset      => INTERVAL '7 days',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE);

SELECT add_continuous_aggregate_policy('current_1h',
  start_offset      => INTERVAL '90 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE);

SELECT add_continuous_aggregate_policy('current_1d',
  start_offset      => INTERVAL '3 years',
  end_offset        => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists     => TRUE);
```

保留和压缩策略：

```sql
-- 原始数据保留 30 天（默认）
SELECT add_retention_policy('raw_current_measurements',
  INTERVAL '30 days',
  if_not_exists => TRUE);

-- 7 天以上的 chunk 自动压缩
ALTER TABLE raw_current_measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'sensor_sn,device_id'
);

SELECT add_compression_policy('raw_current_measurements',
  INTERVAL '7 days',
  if_not_exists => TRUE);
```

保留天数可在运行中修改，无需重建数据库：

```bash
make set-retention DAYS=60
```

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

订阅配置：

- Topic（传感器端）：`wlpca/<sensorSn>/data`
- Worker 内部订阅（Shared Subscription）：`$share/ingestion-workers/wlpca/+/data`
  - Mosquitto 将每条消息只投递给订阅组内的一个 worker（轮询），实现多副本下的无重复消费
- QoS：建议 1
- ClientId：`current-platform-ingestion-worker-<hostname>`（每副本自动追加主机名后缀，防止 ID 冲突）

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

- `<= 6 小时`：查询 `raw_current_measurements`（秒级原始数据）
- `> 6 小时 && <= 7 天`：查询 `current_1m`（1 分钟聚合）
- `> 7 天 && <= 90 天`：查询 `current_1h`（1 小时聚合）
- `> 90 天`：查询 `current_1d`（1 天聚合）

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
GET    /api/v1/admin/users
POST   /api/v1/admin/users
PATCH  /api/v1/admin/users/:userId          # 修改 email / name / password / status
DELETE /api/v1/admin/users/:userId
POST   /api/v1/admin/users/:userId/roles
POST   /api/v1/admin/users/:userId/sensors/batch   # 批量分配传感器权限

GET    /api/v1/admin/sensors                # 列表含最后上报时间和活跃状态
PATCH  /api/v1/admin/sensors/:sensorSn      # 修改传感器显示名称

GET    /api/v1/admin/audit-logs
```

---

## 9. 前端设计

### 9.1 页面清单

已实现功能：

- 国际化（简体中文 / English），运行时切换
- Light / Dark / System 主题，浏览器级持久化
- Microsoft Entra ID SSO 登录（可选）
- 本地用户名 + 密码登录（始终可用）

#### 9.1.1 登录页

- SSO 登录按钮（需配置 Entra ID 环境变量）
- 本地邮箱 + 密码登录表单
- 语言切换

#### 9.1.2 首页 / 仪表盘

- 传感器总数
- 在线传感器数（`SENSOR_ACTIVE_THRESHOLD_HOURS` 内有上报的传感器）
- 今日数据点数
- 最近导出任务

#### 9.1.3 电流数据页

- Sensor 选择框（仅展示当前用户有权限的传感器）
- Device 选择框
- 时间范围选择器
- 分辨率选择器（auto / raw / 1m / 1h / 1d）
- 查询按钮
- 导出按钮
- 摘要统计卡片（min / max / avg / count）
- 折线图（ECharts，聚合数据展示平均线 + 最小最大区间）
- 明细数据表格

#### 9.1.4 导出任务页

- 任务列表（状态、文件格式、时间范围）
- 下载按钮
- 任务完成 / 失败时应用内 toast 通知
- 导出任务 24 小时后自动清理（由 `EXPORT_JOB_RETENTION_HOURS` 控制）

#### 9.1.5 用户权限管理页（Admin）

- 用户列表（含搜索、角色/状态筛选、可排序列）
- 创建 / 编辑 / 删除用户
- 角色分配
- 传感器权限批量分配

#### 9.1.6 传感器管理页（Admin）

- 传感器列表（含最后上报时间、活跃状态）
- 修改传感器显示名称

#### 9.1.7 审计日志页

- 日志列表
- 按操作类型 / 日期范围筛选

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
- **Mosquitto 使用自定义 `docker-entrypoint.sh`**：启动时从环境变量 `MQTT_USERNAME` / `MQTT_PASSWORD` 动态生成 `/tmp/mosquitto.passwd`，无需手动维护密码文件

**Dockerfile 关键注意事项：**

- Azure China 构建使用 `mcr.azure.cn/devcontainers/javascript-node:20-bookworm` 作为 builder 镜像，使用 `mcr.azure.cn/azurelinux/base/nodejs:20.14` 作为 runner 镜像，避免 ACR Tasks 访问 Docker Hub
- Mosquitto ACI 镜像基于 `mcr.azure.cn/devcontainers/base:bookworm` 并通过 Debian 包安装 `mosquitto`，避免 ACR Tasks 拉取 Docker Hub 的 `eclipse-mosquitto`
- Mosquitto 属于基础设施镜像，日常应用发布不随 `azure-build` 重建；仅在 `infra/aci/Dockerfile.mosquitto` 或 `infra/docker/mosquitto/` 改动时运行 `make azure-build-mqtt`
- Azure Linux NodeJS 镜像已包含 OpenSSL；Prisma 使用 glibc 引擎，无需 Alpine 的 `apk add --no-cache openssl`
- builder 阶段固定 `pnpm@9.15.9`，避免标准镜像内置的新版 pnpm 要求 Node 22+
- builder 阶段使用标准 Node 开发镜像自带的 `python3`、`make`、`gcc/g++` 和 Node headers，并设置 `npm_config_build_from_source=true`、`npm_config_nodedir=/usr/local`，确保 `bcrypt` 等 native addon 不依赖外部预编译包
- Prisma `schema.prisma` 中声明 `binaryTargets = ["native", "debian-openssl-3.0.x"]`，覆盖本机构建和 Azure amd64 部署
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
MQTT_SHARED_GROUP=ingestion-workers
MQTT_USERNAME=iot_device
MQTT_PASSWORD=change-me-mqtt-password   # 生产环境必须修改

# backend（注意：PORT=3001 仅作用于 backend，frontend 在 docker-compose 中显式覆盖为 3000）
PORT=3001
EXPORT_DIR=/app/exports
JWT_SECRET=your-jwt-secret-change-in-production   # 生产环境必须修改
JWT_EXPIRES_IN=24h

# 行为配置
SENSOR_ACTIVE_THRESHOLD_HOURS=24   # 传感器超过此时间无上报则标记为 Inactive
EXPORT_JOB_RETENTION_HOURS=24      # 导出任务及文件保留时长

# ingestion worker 调优
INGESTION_CONCURRENCY=10   # 每副本最大并发消息处理数
DB_POOL_MAX=20             # 每副本 PostgreSQL 连接池上限

# 初始管理员（后端首次启动时自动创建，若用户表为空）
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=Admin@123456   # 生产环境必须修改
INITIAL_ADMIN_NAME=Administrator

# Entra ID（可选，后端 Authorization Code + PKCE）
COOKIE_SECRET=your-independent-cookie-secret
ENTRA_CLIENT_ID=your-client-id
ENTRA_CLIENT_SECRET=your-client-secret
ENTRA_TENANT_ID=your-tenant-id
ENTRA_REDIRECT_URI=http://localhost:3000/api/v1/auth/entra/callback
ENTRA_POST_LOGIN_REDIRECT=http://localhost:3000/auth/callback

# frontend
NEXT_PUBLIC_API_BASE_URL=                        # 留空，浏览器使用同源 /api
BACKEND_ORIGIN=http://localhost:3001             # Next.js 服务端代理目标

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

### 10.5 启动脚本与 Makefile

提供以下脚本（均通过 `Makefile` 封装，推荐使用 `make` 命令）：

| 命令                         | 说明                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `make up`                    | 初始化目录并启动全部服务（首次自动复制 `.env.example`） |
| `make down`                  | 停止所有服务（数据保留）                                |
| `make restart`               | 停止后重启                                              |
| `make rebuild`               | 仅重建应用容器（不重启基础服务）                        |
| `make reset`                 | ⚠️ 清空所有数据并重建                                   |
| `make logs`                  | 查看全部日志                                            |
| `make ps`                    | 查看容器状态                                            |
| `make db-shell`              | 进入 psql                                               |
| `make set-retention DAYS=30` | 修改原始数据保留天数                                    |
| `make scale-ingestion N=3`   | 启动 N 个 ingestion-worker 副本                         |
| `make test-mqtt`             | 发送 3 批测试 MQTT 消息                                 |
| `make help`                  | 查看所有可用命令                                        |

### 10.6 Ingestion Worker 水平扩展

ingestion-worker 是无状态的，支持多副本水平扩展：

- 所有副本通过 **MQTT Shared Subscription** 订阅同一 topic，Mosquitto 轮询投递，每条消息只处理一次
- 写入使用 `ON CONFLICT DO NOTHING`，幂等安全
- ClientId 自动追加主机名后缀，防止副本间 ID 冲突

```bash
# 启动 3 个副本
make scale-ingestion N=3

# 或直接：
docker compose up -d --scale ingestion-worker=3
```

**资源规划（N 个副本）：**

| 指标           | 计算方式                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| 最大并发消息数 | N × `INGESTION_CONCURRENCY`                                                 |
| DB 连接数      | N × `DB_POOL_MAX`（需低于 PostgreSQL `max_connections` 减去其他服务的用量） |

### 10.7 自动初始化边界与升级策略

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

### 10.8 健康检查与监控

- 每个服务建议暴露 `/health`
- Compose 中为 `postgres`、`redis`、`backend` 等关键服务配置 `healthcheck`
- `healthcheck` 可避免 `backend` 在依赖尚未就绪时提前启动报错

开发环境建议使用本地目录挂载，便于观察数据和重置环境；生产环境建议切换为 named volume。

---

## 11. 验收与交付

> 本节记录项目验收标准及已完成的交付物清单。

### 11.1 验收标准

一键启动验收：

```bash
make up
```

应满足：

- PostgreSQL 启动并自动初始化 schema
- Redis 启动
- Mosquitto 启动（含认证配置）
- Backend 启动，`/health` 返回 200
- Ingestion Worker 启动，连接 MQTT broker
- Export Worker 启动
- Frontend 启动，http://localhost:3000 可访问

基础链路验收：

1. 向 Mosquitto 发布测试 MessagePack 消息（`make test-mqtt`）
2. ingestion-worker 自动消费，秒级点位入库成功
3. 前端可查询并展示图表（折线图 + 聚合视图）
4. 可发起导出任务，前端 toast 通知，文件可下载

权限链路验收：

1. 本地管理员账号（`INITIAL_ADMIN_*`）可登录
2. 未授权传感器无法访问
3. 已授权传感器可正常查询和导出
4. （可选）用户通过 Entra ID SSO 登录，后端识别用户

### 11.2 已交付物

- [x] 完整源码（monorepo）
- [x] `docker-compose.yml`
- [x] `.env.example`
- [x] SQL 初始化脚本（`infra/docker/postgres/init/`）
- [x] `README.md`（含快速启动、MQTT 测试、常用命令、Azure 快速参考）
- [x] `DEPLOYMENT.md`（含生产加固清单）
- [x] `DEPLOYMENT.AZURE.md`（Azure China 全栈部署指南）
- [x] `architecture.md`（本文档，含 Azure 生产拓扑）
- [x] 测试 MQTT 发布脚本（`scripts/test-mqtt.js`）
- [x] 参考 Payload 文件（`scripts/mock-payload.json`）
- [x] Swagger UI（`http://localhost:3001/api/docs`）
- [x] Makefile（含所有运维快捷命令）

---

## 12. Azure 生产拓扑

本节描述项目在 Azure China (21Vianet) 生产环境的部署形态，与第 10 节 Docker Compose 本地开发架构并列。

### 12.1 服务映射

| Azure 资源 | 类型 | 对应服务 |
| --- | --- | --- |
| `cyberbee` (Web App) | Azure App Service | Next.js 前端 + NestJS 后端（同一容器，同一 origin） |
| `cyberbee-services` | Azure Container App | ingestion-worker + export-worker（同一 revision，两个容器） |
| `dev-butterfly` | ACI | Mosquitto MQTT Broker，公网 TCP 1883 |
| `cyberbee` (Redis) | Azure Cache for Redis | BullMQ 作业队列 + Entra 登录码存储（TLS 6380） |
| `cyberbeestorage` / `butterfly-exports` | Storage Account / File Share | 导出文件，挂载至 `/app/exports` |
| `butterfly-pg` | PostgreSQL Flexible Server | 应用数据库（保持原有资源组） |
| `cyberbee.azurecr.cn` | Azure Container Registry | 容器镜像，按 git SHA 打标签 |

### 12.2 合并镜像结构（`butterfly/web`）

`apps/web/Dockerfile.azure` 使用三阶段构建，将 NestJS 和 Next.js 打包进同一镜像：

```
Stage 1: backend-builder   — pnpm install + nest build → /app/dist
Stage 2: frontend-builder  — pnpm install + next build → standalone
Stage 3: runner            — Node 20 Alpine
    /app/           ← NestJS (port 3001, loopback only)
    /frontend/      ← Next.js standalone (port 3000, 0.0.0.0)
    /entrypoint.js  ← PID-1 supervisor
```

`apps/web/entrypoint.js` 作为 PID-1 启动并管理两个子进程，任一子进程退出则终止整个容器（fail-fast 语义）。浏览器通过同源 `/api` 路径访问后端，无需跨域配置。

### 12.3 Redis TLS 兼容性

Azure Cache for Redis 需要 TLS（端口 6380）和访问密钥。代码中通过以下环境变量启用：

```env
REDIS_HOST=<name>.redis.cache.chinacloudapi.cn
REDIS_PORT=6380
REDIS_PASSWORD=<access-key>
REDIS_TLS=true
```

所有使用 Redis 的模块（BullMQ、IORedis、Entra Code Store）均已兼容这两种模式：
- `REDIS_TLS=true` → TLS 连接（生产）
- 未设置 → 普通连接（本地 Docker Compose）

### 12.4 ACR Tasks（云端构建）

镜像构建使用 `az acr build`（ACR Tasks），在 ACR 托管的 linux/amd64 环境中完成，构建完成后直接推送到 ACR。无需本地 Docker daemon，在 Apple Silicon、Intel Mac、Linux 及 CI 环境均能产出一致的 amd64 镜像。

### 12.5 部署命令

```bash
# 一键全栈部署（构建 → 迁移 → 存储 → 三服务部署）
make azure-all

# 单独部署
make azure-deploy-mqtt       # Mosquitto ACI
make azure-deploy-services   # Container App（两个 worker）
make azure-deploy-web        # Web App（合并镜像）

# 查看状态和端点
make azure-status

# 查看日志
make azure-logs-web
make azure-logs-services CONTAINER=ingestion-worker
make azure-logs-mqtt
```

详细操作见 `DEPLOYMENT.AZURE.md`。
