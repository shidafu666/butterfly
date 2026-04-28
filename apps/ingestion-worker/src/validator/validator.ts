export interface ValidatedPayload {
  msgId: string;
  sn: string;
  devices: Array<{
    deviceId: string;
    deviceData: {
      timestamp: number;
      rms: number[];
    };
  }>;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function validatePayload(raw: unknown, topicSn: string): ValidatedPayload {
  if (!isRecord(raw)) {
    throw new Error('Payload is not an object');
  }

  const msgId = raw['msgId'];
  if ((typeof msgId !== 'string' && typeof msgId !== 'number') || String(msgId).trim() === '') {
    throw new Error('Invalid or missing msgId: must be a non-empty string or number');
  }

  const sn = raw['sn'];
  if (typeof sn !== 'string' || sn.trim() === '') {
    throw new Error('Invalid or missing sn: must be a non-empty string');
  }

  if (sn !== topicSn) {
    throw new Error(`Payload sn "${sn}" does not match topic sn "${topicSn}"`);
  }

  const devices = raw['devices'];
  if (!Array.isArray(devices)) {
    throw new Error('Invalid or missing devices: must be an array');
  }
  if (devices.length === 0) {
    throw new Error('devices array must not be empty');
  }

  const validatedDevices = devices.map((device: unknown, index: number) => {
    if (!isRecord(device)) {
      throw new Error(`devices[${index}] is not an object`);
    }

    const deviceId = device['deviceId'];
    if (typeof deviceId !== 'string' || deviceId.trim() === '') {
      throw new Error(`devices[${index}].deviceId must be a non-empty string`);
    }

    const deviceData = device['deviceData'];
    if (!isRecord(deviceData)) {
      throw new Error(`devices[${index}].deviceData is not an object`);
    }

    const timestampRaw = deviceData['timestamp'];
    let timestamp: number;
    if (timestampRaw instanceof Date) {
      timestamp = timestampRaw.getTime() / 1000;
    } else if (typeof timestampRaw === 'bigint') {
      timestamp = Number(timestampRaw);
    } else if (typeof timestampRaw === 'number') {
      timestamp = timestampRaw;
    } else {
      throw new Error(
        `devices[${index}].deviceData.timestamp must be a positive finite number (unix seconds)`,
      );
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error(
        `devices[${index}].deviceData.timestamp must be a positive finite number (unix seconds)`,
      );
    }
    // Sanity check: unix timestamp should be between year 2000 and year 2100
    if (timestamp < 946684800 || timestamp > 4102444800) {
      throw new Error(
        `devices[${index}].deviceData.timestamp ${timestamp} is out of a reasonable range`,
      );
    }

    const rms = deviceData['rms'];
    if (!Array.isArray(rms)) {
      throw new Error(`devices[${index}].deviceData.rms must be an array`);
    }
    if (rms.length === 0) {
      throw new Error(`devices[${index}].deviceData.rms must not be empty`);
    }
    for (let i = 0; i < rms.length; i++) {
      if (typeof rms[i] !== 'number' || !Number.isFinite(rms[i])) {
        throw new Error(`devices[${index}].deviceData.rms[${i}] must be a finite number`);
      }
    }

    return {
      deviceId: deviceId as string,
      deviceData: {
        timestamp: timestamp as number,
        rms: rms as number[],
      },
    };
  });

  return {
    msgId: String(msgId),
    sn: sn as string,
    devices: validatedDevices,
  };
}
