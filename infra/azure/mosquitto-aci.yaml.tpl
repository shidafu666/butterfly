# ============================================================
# Butterfly — Mosquitto MQTT ACI 部署模板
# 由 scripts/deploy-azure.sh 通过 envsubst 生成 mosquitto-aci.yaml
# 仅包含 Mosquitto，只暴露 TCP 1883；MQTT 凭据通过 secureValue 注入。
# ============================================================
apiVersion: '2021-10-01'
location: ${ACI_LOCATION}
name: ${ACI_MQTT_NAME}
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
        port: 1883
  volumes:
    - name: mosquitto-data
      emptyDir: {}
  containers:
    - name: mosquitto
      properties:
        image: ${MOSQUITTO_IMAGE}
        resources:
          requests:
            cpu: 0.5
            memoryInGb: 0.5
        ports:
          - port: 1883
        environmentVariables:
          - name: MQTT_USERNAME
            value: "${MQTT_USERNAME}"
          - name: MQTT_PASSWORD
            secureValue: "${MQTT_PASSWORD}"
        volumeMounts:
          - name: mosquitto-data
            mountPath: /mosquitto/data
