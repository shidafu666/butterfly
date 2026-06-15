type LogLevel = 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

const SERVICE = 'ingestion-worker';

function shanghaiTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function normalizeError(err: unknown): LogFields {
  if (!(err instanceof Error)) {
    return { error: String(err) };
  }

  return {
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
  };
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const now = new Date();
  const line = JSON.stringify({
    ts: now.toISOString(),
    tsShanghai: shanghaiTimestamp(now),
    level,
    service: SERVICE,
    event,
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logError(event: string, err: unknown, fields: LogFields = {}): void {
  log('error', event, {
    ...fields,
    ...normalizeError(err),
  });
}
