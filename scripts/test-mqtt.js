#!/usr/bin/env node
/**
 * Test MQTT Publisher
 * Sends a mock MessagePack-encoded MQTT message to the broker,
 * matching the real sensor payload format (see scripts/mock-payload.json).
 *
 * Simulates a single 1-hour batch: one device, 3600 rms values.
 *
 * Usage:
 *   node scripts/test-mqtt.js [broker_url] [sensor_sn] [username] [password]
 *
 * Credentials are read from args first, then env vars MQTT_USERNAME / MQTT_PASSWORD.
 *
 * Examples:
 *   node scripts/test-mqtt.js
 *   node scripts/test-mqtt.js mqtt://localhost:1883 863434080879965
 *   node scripts/test-mqtt.js mqtt://localhost:1883 863434080879965 iot_device secret123
 */

const mqtt = require('mqtt');
const { pack } = require('msgpackr');

const BROKER_URL = process.argv[2] || 'mqtt://localhost:1883';
const SENSOR_SN  = process.argv[3] || '863434080879965';
const USERNAME   = process.argv[4] || process.env.MQTT_USERNAME || '';
const PASSWORD   = process.argv[5] || process.env.MQTT_PASSWORD || '';
const TOPIC      = `wlpca/${SENSOR_SN}/data`;

const RMS_COUNT = 3600; // 1 hour of 1-second samples

/**
 * Generate realistic current readings (A) based on the observed sensor pattern.
 * Values fluctuate around a base load with occasional dips and spikes.
 */
function generateRms(count) {
  const values = [];
  // Quantization levels seen in real data (0.1A steps)
  const levels = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
                  3.0, 3.1, 3.2, 3.3, 3.4, 3.5];

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

const now = Math.floor(Date.now() / 1000);
const dataStartTimestamp = now - RMS_COUNT; // 1 hour ago

const rms = generateRms(RMS_COUNT);

// Mirrors the real payload structure from mock-payload.json
const payload = {
  msgId:     Date.now(),           // integer, as in real payload
  rssi:      -69,
  timestamp: now,
  sn:        SENSOR_SN,
  version:   '001.002.014',
  battery:   80,
  devices: [
    {
      deviceId:       'slave1',
      deviceFirmware: 28,
      deviceState:    1,
      deviceData: {
        timestamp: dataStartTimestamp,
        rms,
      },
    },
  ],
};

const packed = pack(payload);

const minRms = Math.min(...rms).toFixed(3);
const maxRms = Math.max(...rms).toFixed(3);
const avgRms = (rms.reduce((s, v) => s + v, 0) / rms.length).toFixed(3);
const dataStart = new Date(dataStartTimestamp * 1000).toISOString();
const dataEnd   = new Date(now * 1000).toISOString();

console.log('╔═══════════════════════════════════════════╗');
console.log('║  Butterfly - MQTT Test Publisher           ║');
console.log('╚═══════════════════════════════════════════╝');
console.log('');
console.log(`Broker:      ${BROKER_URL}`);
console.log(`Topic:       ${TOPIC}`);
console.log(`SensorSN:    ${SENSOR_SN}`);
console.log(`Auth:        ${USERNAME ? `user=${USERNAME}` : '(anonymous)'}`);
console.log(`Packed size: ${packed.length} bytes`);
console.log('');
console.log('Payload summary:');
console.log(`  device:      ${payload.devices[0].deviceId}`);
console.log(`  rms count:   ${rms.length} samples (1-second intervals)`);
console.log(`  data window: ${dataStart} → ${dataEnd}`);
console.log(`  current:     min=${minRms}A  avg=${avgRms}A  max=${maxRms}A`);
console.log(`  rssi:        ${payload.rssi} dBm`);
console.log(`  battery:     ${payload.battery}%`);
console.log('');

const client = mqtt.connect(BROKER_URL, {
  clientId: 'butterfly-test-publisher',
  clean: true,
  connectTimeout: 5000,
  ...(USERNAME ? { username: USERNAME, password: PASSWORD } : {}),
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  client.publish(TOPIC, packed, { qos: 1 }, (err) => {
    if (err) {
      console.error('❌ Publish failed:', err.message);
      process.exit(1);
    }
    console.log(`✅ Published ${rms.length} data points for sensor ${SENSOR_SN}`);
    console.log(`   → sensor ${SENSOR_SN} / device slave1 should appear in the frontend`);
    client.end();
  });
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  console.error('   Make sure Mosquitto is running: docker compose up mosquitto');
  process.exit(1);
});
