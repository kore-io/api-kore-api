import { Redis } from 'ioredis';

/**
 * No fim de cada arquivo (depois dos afterAll dele), apaga as chaves das filas
 * do prefixo do arquivo (test/setup/load-test-env.ts): os agendamentos e os
 * jobs que ninguém mais vai processar.
 */
afterAll(async () => {
  const prefix = process.env.QUEUE_PREFIX;
  if (!prefix) return;
  const redis = new Redis(process.env.REDIS_URL ?? '', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // Sem Redis, nada a limpar (os e2e que precisam dele já falharam).
  } finally {
    redis.disconnect();
  }
});
