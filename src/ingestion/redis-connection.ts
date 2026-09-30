import { ConnectionOptions } from 'bullmq';

/** Local Redis for the ingestion queue. 6380 avoids the other Redis already bound to 6379. */
export function redisConnection(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6380),
    maxRetriesPerRequest: null,
  };
}
