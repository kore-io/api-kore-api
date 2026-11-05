import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function storageWith({ evalResult }: { evalResult: () => Promise<unknown> }) {
  const evalFn = jest.fn(evalResult);
  const redis = { eval: evalFn } as unknown as Redis;
  return { storage: new RedisThrottlerStorage(redis, 'kore:test:rl:'), evalFn };
}

describe('RedisThrottlerStorage', () => {
  it('dado um acesso dentro do limite, quando conta, então não bloqueia e informa o tempo restante em segundos', async () => {
    const { storage, evalFn } = storageWith({ evalResult: () => Promise.resolve([3, 42_100]) });

    const record = await storage.increment('general:1.2.3.4', 60_000, 100);

    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(evalFn).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'kore:test:rl:general:1.2.3.4',
      60_000,
    );
  });

  it('dado um acesso acima do limite, quando conta, então bloqueia até a janela acabar', async () => {
    const { storage } = storageWith({ evalResult: () => Promise.resolve([11, 30_000]) });

    const record = await storage.increment('auth:1.2.3.4', 60_000, 10);

    expect(record).toEqual({
      totalHits: 11,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('decisão 97 (3) - dado o Redis fora do ar, quando conta, então deixa a requisição passar', async () => {
    const { storage } = storageWith({
      evalResult: () => Promise.reject(new Error('Connection is closed.')),
    });

    const record = await storage.increment('general:1.2.3.4', 60_000, 100);

    expect(record.isBlocked).toBe(false);
  });
});
