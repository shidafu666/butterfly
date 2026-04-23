# ============================================================
# Butterfly — Azure Container Instances 部署模板
# 由 scripts/deploy-aci.sh 通过 envsubst 生成 deploy.yaml
# 请勿手动编辑 deploy.yaml，修改此模板后重新 make aci-deploy
# ============================================================
apiVersion: '2021-10-01'
location: ${AZURE_LOCATION}
name: ${ACI_CONTAINER_GROUP_NAME}
type: Microsoft.ContainerInstance/containerGroups
properties:
  osType: Linux
  restartPolicy: ${ACI_RESTART_POLICY}
  imageRegistryCredentials:
    - server: ${ACR_LOGIN_SERVER}
      username: ${ACR_USERNAME}
      password: ${ACR_PASSWORD}
  ipAddress:
    type: Public
    dnsNameLabel: ${ACI_DNS_LABEL}
    ports:
      - protocol: TCP
        port: 3000
      - protocol: TCP
        port: 3001
      - protocol: TCP
        port: 1883
  volumes:
    - name: exports
      azureFile:
        shareName: ${AZURE_FILE_SHARE_NAME}
        storageAccountName: ${AZURE_STORAGE_ACCOUNT}
        storageAccountKey: ${AZURE_STORAGE_KEY}
    - name: mosquitto-data
      emptyDir: {}
  containers:
    # ─── Redis ──────────────────────────────────────────────────
    - name: redis
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/redis:${REDIS_IMAGE_TAG}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 0.5

    # ─── Mosquitto (MQTT Broker) ────────────────────────────────
    - name: mosquitto
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/mosquitto:${IMAGE_TAG}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 0.5
        ports:
          - port: 1883
          - port: 9001
        environmentVariables:
          - name: MQTT_USERNAME
            value: "${MQTT_USERNAME}"
          - name: MQTT_PASSWORD
            secureValue: "${MQTT_PASSWORD}"
        volumeMounts:
          - name: mosquitto-data
            mountPath: /mosquitto/data

    # ─── Backend (NestJS API) ───────────────────────────────────
    - name: backend
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/backend:${IMAGE_TAG}
        resources:
          requests:
            cpu: 1.0
            memoryInGb: 1.5
        ports:
          - port: 3001
        environmentVariables:
          - name: NODE_ENV
            value: "production"
          - name: DATABASE_URL
            secureValue: "${DATABASE_URL}"
          - name: REDIS_HOST
            value: "localhost"
          - name: REDIS_PORT
            value: "6379"
          - name: EXPORT_DIR
            value: "/app/exports"
          - name: PORT
            value: "3001"
          - name: JWT_SECRET
            secureValue: "${JWT_SECRET}"
          - name: JWT_EXPIRES_IN
            value: "${JWT_EXPIRES_IN}"
          - name: SENSOR_ACTIVE_THRESHOLD_HOURS
            value: "${SENSOR_ACTIVE_THRESHOLD_HOURS}"
          - name: EXPORT_JOB_RETENTION_HOURS
            value: "${EXPORT_JOB_RETENTION_HOURS}"
          - name: MQTT_URL
            value: "mqtt://localhost:1883"
          - name: MQTT_USERNAME
            value: "${MQTT_USERNAME}"
          - name: MQTT_PASSWORD
            secureValue: "${MQTT_PASSWORD}"
          - name: INITIAL_ADMIN_EMAIL
            value: "${INITIAL_ADMIN_EMAIL}"
          - name: INITIAL_ADMIN_PASSWORD
            secureValue: "${INITIAL_ADMIN_PASSWORD}"
          - name: INITIAL_ADMIN_NAME
            value: "${INITIAL_ADMIN_NAME}"
          - name: JWT_AUDIENCE
            value: "${JWT_AUDIENCE}"
          - name: JWT_ISSUER
            value: "${JWT_ISSUER}"
        volumeMounts:
          - name: exports
            mountPath: /app/exports

    # ─── Frontend (Next.js) ─────────────────────────────────────
    - name: frontend
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/frontend:${IMAGE_TAG}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 0.5
        ports:
          - port: 3000
        environmentVariables:
          - name: NODE_ENV
            value: "production"
          - name: PORT
            value: "3000"
          - name: HOSTNAME
            value: "0.0.0.0"

    # ─── Ingestion Worker (MQTT → DB) ──────────────────────────
    - name: ingestion-worker
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/ingestion-worker:${IMAGE_TAG}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 1.0
        environmentVariables:
          - name: NODE_ENV
            value: "production"
          - name: DATABASE_URL
            secureValue: "${DATABASE_URL}"
          - name: MQTT_URL
            value: "mqtt://localhost:1883"
          - name: MQTT_TOPIC
            value: "wlpca/+/data"
          - name: MQTT_CLIENT_ID
            value: "current-platform-ingestion-worker"
          - name: MQTT_SHARED_GROUP
            value: "ingestion-workers"
          - name: MQTT_USERNAME
            value: "${MQTT_USERNAME}"
          - name: MQTT_PASSWORD
            secureValue: "${MQTT_PASSWORD}"
          - name: INGESTION_CONCURRENCY
            value: "${INGESTION_CONCURRENCY}"
          - name: DB_POOL_MAX
            value: "${DB_POOL_MAX}"

    # ─── Export Worker (CSV/Log exporter) ──────────────────────
    - name: export-worker
      properties:
        image: ${ACR_LOGIN_SERVER}/butterfly/export-worker:${IMAGE_TAG}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 0.5
        environmentVariables:
          - name: NODE_ENV
            value: "production"
          - name: DATABASE_URL
            secureValue: "${DATABASE_URL}"
          - name: REDIS_HOST
            value: "localhost"
          - name: REDIS_PORT
            value: "6379"
          - name: EXPORT_DIR
            value: "/app/exports"
        volumeMounts:
          - name: exports
            mountPath: /app/exports
