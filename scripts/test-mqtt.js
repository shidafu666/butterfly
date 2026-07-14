#!/usr/bin/env node
/**
 * Test MQTT Publisher
 * Sends mock MessagePack-encoded MQTT messages to the broker,
 * matching the real sensor payload format (see scripts/mock-payload.json).
 *
 * Simulates 3 consecutive 1-hour batches (3 hours total):
 *   batch 1: [now-3h, now-2h)
 *   batch 2: [now-2h, now-1h)
 *   batch 3: [now-1h, now)
 *
 * Usage:
 *   node scripts/test-mqtt.js [broker_url] [sensor_sn] [username] [password] [hours]
 *
 * Credentials are read from args first, then env vars MQTT_USERNAME / MQTT_PASSWORD.
 * Batch count (hours) is read from arg 6 first, then env vars HOURS / BATCH_COUNT.
 *
 * Examples:
 *   node scripts/test-mqtt.js
 *   node scripts/test-mqtt.js mqtt://localhost:1883 863434080879965
 *   node scripts/test-mqtt.js mqtt://localhost:1883 863434080879965 iot_device secret123
 *   node scripts/test-mqtt.js mqtt://localhost:1883 863434080879965 iot_device secret123 24
 */

const mqtt = require('mqtt');
const { pack } = require('msgpackr');

const BROKER_URL = process.argv[2] || process.env.BROKER_URL || 'mqtt://localhost:1883';
const SENSOR_SN = process.argv[3] || '863434080879965';
const USERNAME = process.argv[4] || process.env.MQTT_USERNAME || '';
const PASSWORD = process.argv[5] || process.env.MQTT_PASSWORD || '';
const HOURS_ARG = process.argv[6] || process.env.HOURS || process.env.BATCH_COUNT || '3';
const TOPIC = `wlpca/${SENSOR_SN}/data`;

const RMS_COUNT = 3600; // 1 hour of 1-second samples
const BATCH_COUNT = parseBatchCount(HOURS_ARG);

function parseBatchCount(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Invalid batch count/hours: ${value}`);
    console.error(
      'Usage: node scripts/test-mqtt.js [broker_url] [sensor_sn] [username] [password] [hours]',
    );
    process.exit(1);
  }

  return parsed;
}

/**
 * Generate realistic current readings (A) based on the observed sensor pattern.
 * Values fluctuate around a base load with occasional dips and spikes.
 */
function generateRms(count) {
  const values = [];
  let current = 3.1; // start near the typical load

  for (let i = 0; i < count; i++) {
    // Slow drift + small random walk, quantized to 0.1A
    const drift = (Math.random() - 0.5) * 0.3;
    current = Math.max(2.0, Math.min(3.5, current + drift));

    // Snap to nearest 0.1A level (matching real sensor quantization)
    const snapped = Math.round(current * 10) / 10;
    values.push(parseFloat(snapped.toFixed(1)));

    // Occasionally take a larger step to simulate load changes
    if (Math.random() < 0.02) {
      current += (Math.random() - 0.5) * 0.6;
    }
  }
  return values;
}

// Build all batches up front
const now = Math.floor(Date.now() / 1000);

const batches = Array.from({ length: BATCH_COUNT }, (_, i) => {
  const batchStart = now - (BATCH_COUNT - i) * RMS_COUNT; // e.g. now-3h, now-2h, now-1h
  const rms = generateRms(RMS_COUNT);
  const minRms = Math.min(...rms).toFixed(3);
  const maxRms = Math.max(...rms).toFixed(3);
  const avgRms = (rms.reduce((s, v) => s + v, 0) / rms.length).toFixed(3);

  return {
    windowLabel: `[${new Date(batchStart * 1000).toISOString()} → ${new Date((batchStart + RMS_COUNT) * 1000).toISOString()}]`,
    payload: {
      msgId: Date.now() + i, // unique integer per message
      rssi: -69,
      timestamp: batchStart + RMS_COUNT, // end of the window, as in real payloads
      sn: SENSOR_SN,
      version: '001.002.014',
      battery: 80,
      devices: [
        {
          deviceId: 'slave1',
          deviceFirmware: 28,
          deviceState: 1,
          deviceData: {
            timestamp: batchStart,
            rms,
          },
        },
      ],
    },
    stats: { minRms, maxRms, avgRms },
  };
});

console.log('╔═══════════════════════════════════════════╗');
console.log('║      CyberBee - MQTT Test Publisher      ║');
console.log('╚═══════════════════════════════════════════╝');
console.log('');
console.log(`Broker:    ${BROKER_URL}`);
console.log(`Topic:     ${TOPIC}`);
console.log(`SensorSN:  ${SENSOR_SN}`);
console.log(`Auth:      ${USERNAME ? `user=${USERNAME}` : '(anonymous)'}`);
console.log(`Batches:   ${BATCH_COUNT} × ${RMS_COUNT} samples (${BATCH_COUNT} hours total)`);
console.log('');

const client = mqtt.connect(BROKER_URL, {
  clientId: 'butterfly-test-publisher',
  clean: true,
  connectTimeout: 5000,
  ...(USERNAME ? { username: USERNAME, password: PASSWORD } : {}),
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  console.log('');

  // Publish batches sequentially
  let index = 0;

  function publishNext() {
    if (index >= batches.length) {
      console.log(
        `✅ Done — ${BATCH_COUNT} batches published for sensor ${SENSOR_SN} / device slave1`,
      );
      console.log('   → data should now appear in the frontend');
      client.end();
      return;
    }

    const { windowLabel, payload, stats } = batches[index];
    const packed = pack(payload);

    client.publish(TOPIC, packed, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Batch ${index + 1} publish failed:`, err.message);
        process.exit(1);
      }
      console.log(`  [${index + 1}/${BATCH_COUNT}] ${windowLabel}`);
      console.log(
        `         current: min=${stats.minRms}A  avg=${stats.avgRms}A  max=${stats.maxRms}A  (${packed.length} bytes)`,
      );
      index++;
      publishNext();
    });
  }

  publishNext();
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  console.error('   Make sure Mosquitto is running: docker compose up mosquitto');
  process.exit(1);
});
