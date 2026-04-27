import mqtt from 'mqtt';
import { Pool } from 'pg';
import pLimit from 'p-limit';
import os from 'os';
import { handleMessage } from './handler';

export async function startMqttClient(pool: Pool): Promise<void> {
  const mqttUrl = process.env.MQTT_URL ?? 'mqtt://mosquitto:1883';

  // Append hostname so each scaled replica gets a unique clientId.
  // Without this, a second instance would kick the first off the broker.
  const baseClientId = process.env.MQTT_CLIENT_ID ?? 'current-platform-ingestion-worker';
  const clientId = `${baseClientId}-${os.hostname()}`;

  // Shared subscription: all replicas join the same group so each message is
  // delivered to exactly ONE worker (Mosquitto 2 round-robin dispatch).
  // Format: $share/<group>/<topic>
  // The message handler still receives the original topic (e.g. wlpca/SN/data),
  // not the $share/... prefix, so parseSensorSnFromTopic works unchanged.
  const rawTopic = process.env.MQTT_TOPIC ?? 'wlpca/+/data';
  const sharedGroup = process.env.MQTT_SHARED_GROUP ?? 'ingestion-workers';
  const topic = `$share/${sharedGroup}/${rawTopic}`;

  // Limit how many messages are processed concurrently on this instance.
  // Prevents a burst of 100+ simultaneous messages from exhausting the DB pool.
  const concurrency = parseInt(process.env.INGESTION_CONCURRENCY ?? '10', 10);
  const limit = pLimit(concurrency);

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
    console.log(
      `[ingestion-worker] Connected to ${mqttUrl} ` +
        `(clientId=${clientId}, concurrency=${concurrency})`,
    );
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[ingestion-worker] Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`[ingestion-worker] Subscribed: ${topic}`);
      }
    });
  });

  client.on('reconnect', () => {
    console.log('[ingestion-worker] Reconnecting to MQTT broker...');
  });

  client.on('disconnect', () => {
    console.log('[ingestion-worker] Disconnected from MQTT broker.');
  });

  client.on('offline', () => {
    console.warn('[ingestion-worker] MQTT client is offline.');
  });

  client.on('message', (topic: string, buffer: Buffer) => {
    // Wrap in p-limit: if concurrency slots are full, this queues in memory
    // until a slot opens.  The MQTT ACK (QoS 1) is sent by the library when
    // the message is handed to this callback, so backpressure is handled by
    // the broker's inflight window rather than lost ACKs.
    limit(() => handleMessage(topic, buffer, pool)).catch((err) => {
      console.error('[ingestion-worker] Unhandled error in handleMessage:', err);
    });
  });

  // Return a promise that never resolves so the process stays alive
  return new Promise((_resolve, reject) => {
    client.on('error', (err) => {
      console.error('[ingestion-worker] MQTT error:', err);
      reject(err);
    });
  });
}
