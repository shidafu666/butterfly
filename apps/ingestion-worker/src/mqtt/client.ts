import mqtt from 'mqtt';
import { Pool } from 'pg';
import { handleMessage } from './handler';

export async function startMqttClient(pool: Pool): Promise<void> {
  const mqttUrl = process.env.MQTT_URL ?? 'mqtt://mosquitto:1883';
  const clientId = process.env.MQTT_CLIENT_ID ?? 'current-platform-ingestion-worker';
  const topic = process.env.MQTT_TOPIC ?? 'wlpca/+/data';

  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;

  const client = mqtt.connect(mqttUrl, {
    clientId,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30_000,
    keepalive: 60,
    ...(username ? { username, password } : {}),
  });

  client.on('connect', () => {
    console.log(`[ingestion-worker] Connected to MQTT broker at ${mqttUrl}`);
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[ingestion-worker] Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`[ingestion-worker] Subscribed to topic: ${topic}`);
      }
    });
  });

  client.on('reconnect', () => {
    console.log('[ingestion-worker] Reconnecting to MQTT broker...');
  });

  client.on('disconnect', () => {
    console.log('[ingestion-worker] Disconnected from MQTT broker.');
  });

  client.on('error', (err) => {
    console.error('[ingestion-worker] MQTT error:', err);
  });

  client.on('offline', () => {
    console.warn('[ingestion-worker] MQTT client is offline.');
  });

  client.on('message', (topic: string, buffer: Buffer) => {
    handleMessage(topic, buffer, pool).catch((err) => {
      console.error('[ingestion-worker] Unhandled error in handleMessage:', err);
    });
  });

  // Return a promise that never resolves so the process stays alive
  return new Promise((_resolve, reject) => {
    client.on('error', reject);
  });
}
