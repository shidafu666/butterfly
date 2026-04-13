// MQTT Payload Types

export interface DeviceData {
  timestamp: number;  // Unix seconds (start of RMS array)
  rms: number[];      // Current RMS values, one per second
}

export interface MqttDevice {
  deviceId: string;
  deviceData: DeviceData;
}

export interface MqttPayload {
  msgId: string;
  sn: string;         // sensor_sn
  devices: MqttDevice[];
}

// Expanded row ready for database insertion
export interface CurrentMeasurementRow {
  sensor_sn: string;
  device_id: string;
  ts: Date;
  current_value: number;
  msg_id: string | null;
  source_topic: string | null;
}
