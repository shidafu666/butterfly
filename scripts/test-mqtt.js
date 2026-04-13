#!/usr/bin/env node
/**
 * Test MQTT Publisher
 * Sends a mock MessagePack-encoded MQTT message to the broker.
 *
 * Usage:
 *   node scripts/test-mqtt.js [broker_url] [sensor_sn] [username] [password]
 *
 * Credentials are read from args first, then env vars MQTT_USERNAME / MQTT_PASSWORD.
 *
 * Examples:
 *   node scripts/test-mqtt.js
 *   node scripts/test-mqtt.js mqtt://localhost:1883 SN123456
 *   node scripts/test-mqtt.js mqtt://localhost:1883 SN123456 iot_device secret123
 */

const mqtt = require('mqtt');
const { pack } = require('msgpackr');

const BROKER_URL = process.argv[2] || 'mqtt://localhost:1883';
const SENSOR_SN  = process.argv[3] || 'SN123456';
const USERNAME   = process.argv[4] || process.env.MQTT_USERNAME || '';
const PASSWORD   = process.argv[5] || process.env.MQTT_PASSWORD || '';
const TOPIC      = `wlpca/${SENSOR_SN}/data`;

// Build a realistic mock payload
const baseTimestamp = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago

const payload = {
  msgId: `test-${Date.now()}`,
  sn: SENSOR_SN,
  devices: [
    {
      deviceId: 'slave1',
      deviceData: {
        timestamp: baseTimestamp,
        rms: [0.11, 0.12, 0.10, 0.13, 0.11, 0.12, 0.14, 0.11, 0.10, 0.12],
      },
    },
    {
      deviceId: 'slave2',
      deviceData: {
        timestamp: baseTimestamp,
        rms: [0.22, 0.21, 0.23, 0.20, 0.22, 0.24, 0.21, 0.22, 0.23, 0.21],
      },
    },
  ],
};

const packed = pack(payload);

console.log('╔═══════════════════════════════════════════╗');
console.log('║  Butterfly - MQTT Test Publisher           ║');
console.log('╚═══════════════════════════════════════════╝');
console.log('');
console.log(`Broker:    ${BROKER_URL}`);
console.log(`Topic:     ${TOPIC}`);
console.log(`SensorSN:  ${SENSOR_SN}`);
console.log(`Auth:      ${USERNAME ? `user=${USERNAME}` : '(anonymous)'}`);
console.log(`Payload:   ${JSON.stringify(payload, null, 2)}`);
console.log(`Packed size: ${packed.length} bytes`);
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
    console.log('✅ Message published successfully!');
    console.log('');
    console.log('Expected DB rows:');
    payload.devices.forEach((device) => {
      device.deviceData.rms.forEach((value, i) => {
        const ts = new Date((device.deviceData.timestamp + i) * 1000).toISOString();
        console.log(
          `  sensor=${SENSOR_SN} device=${device.deviceId} ts=${ts} current=${value}A`
        );
      });
    });
    client.end();
  });
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  console.error('   Make sure Mosquitto is running: docker compose up mosquitto');
  process.exit(1);
});
