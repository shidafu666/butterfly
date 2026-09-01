import IORedis from 'ioredis';
import { log, logError } from '../logger';

export function createRedisConnection(connectionName: string): IORedis {
  const host = process.env.REDIS_HOST ?? 'redis';
  const port = Number.parseInt(process.env.REDIS_PORT ?? '6379', 10);
  const password = process.env.REDIS_PASSWORD;
  const tls = process.env.REDIS_TLS === 'true';

  const connection = new IORedis({
    host,
    port,
    ...(password ? { password } : {}),
    ...(tls ? { tls: {} } : {}),
    connectionName,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on('connect', () => {
    log('info', 'redis_connected', { connectionName, host, port, tls });
  });
  connection.on('error', (err) => {
    logError('redis_connection_error', err, { connectionName, host, port, tls });
  });

  return connection;
}
