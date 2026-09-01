import mqtt from 'mqtt';
import os from 'os';
import { log, logError } from '../logger';
import { IngestionQueueProducer } from '../queue/producer';

export async function startMqttClient(queue: IngestionQueueProducer) {
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

  client.on('error', (err) => {
    logError('mqtt_error', err, { mqttUrl, clientId });
  });

  // MQTT.js sends the QoS 1 PUBACK only after this callback succeeds. Persisting the
  // raw message in Redis here makes the queue the durability boundary: PostgreSQL can
  // be unavailable without losing the message that the broker considers delivered.
  client.handleMessage = (packet, callback) => {
    const payload = Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload);
    const receivedAt = new Date();

    log('info', 'mqtt_message_received', {
      topic: packet.topic,
      payloadBytes: payload.length,
      mqttQos: packet.qos,
      receivedAt: receivedAt.toISOString(),
    });

    void queue
      .enqueue(packet.topic, payload, packet.qos, receivedAt)
      .then(() => callback())
      .catch((err) => {
        logError('mqtt_message_queue_failed', err, {
          topic: packet.topic,
          payloadBytes: payload.length,
          mqttQos: packet.qos,
        });
        callback(err instanceof Error ? err : new Error(String(err)));
      });
  };

  await new Promise<void>((resolve) => {
    client.once('connect', () => resolve());
  });

  await new Promise<void>((resolve, reject) => {
    log('info', 'mqtt_connected', {
      mqttUrl,
      clientId,
      rawTopic,
      sharedGroup,
      subscription: topic,
      username: username ? '<set>' : '<unset>',
    });
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        logError('mqtt_subscribe_failed', err, { subscription: topic });
        reject(err);
      } else {
        log('info', 'mqtt_subscribed', { subscription: topic, qos: 1 });
        resolve();
      }
    });
  });

  client.on('reconnect', () => {
    log('warn', 'mqtt_reconnecting', { mqttUrl, clientId });
  });

  client.on('disconnect', () => {
    log('warn', 'mqtt_disconnected', { mqttUrl, clientId });
  });

  client.on('offline', () => {
    log('warn', 'mqtt_offline', { mqttUrl, clientId });
  });

  return client;
}
