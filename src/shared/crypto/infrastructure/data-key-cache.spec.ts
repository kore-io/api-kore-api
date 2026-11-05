import { DataKeyCache } from './data-key-cache';

function buildCache({ maxEntries = 10 }: { maxEntries?: number } = {}) {
  let now = 0;
  const cache = new DataKeyCache({ ttlMs: 1_000, maxEntries, now: () => now });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('DataKeyCache', () => {
  it('dada uma chave dentro do prazo, quando lê, então devolve a chave', () => {
    const { cache, advance } = buildCache();
    cache.set({ id: 'a', key: Buffer.from('chave-a') });
    advance(999);

    expect(cache.get({ id: 'a' })?.toString()).toBe('chave-a');
  });

  it('dada uma chave vencida, quando lê, então não devolve e remove do cache', () => {
    const { cache, advance } = buildCache();
    cache.set({ id: 'a', key: Buffer.from('chave-a') });
    advance(1_000);

    expect(cache.get({ id: 'a' })).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('dada uma chave já lida, quando ela sai do cache, então a cópia de quem leu continua intacta', () => {
    const { cache } = buildCache({ maxEntries: 1 });
    cache.set({ id: 'a', key: Buffer.from('chave-a') });
    const read = cache.get({ id: 'a' });

    cache.set({ id: 'b', key: Buffer.from('chave-b') }); // tira 'a' e zera o buffer guardado

    expect(read?.toString()).toBe('chave-a');
  });

  it('dado o teto de entradas, quando insere mais uma, então sai a usada há mais tempo (LRU)', () => {
    const { cache } = buildCache({ maxEntries: 2 });
    cache.set({ id: 'a', key: Buffer.from('a') });
    cache.set({ id: 'b', key: Buffer.from('b') });
    cache.get({ id: 'a' }); // 'a' passa a ser a mais recente; 'b' vira a mais antiga
    cache.set({ id: 'c', key: Buffer.from('c') });

    expect(cache.size).toBe(2);
    expect(cache.get({ id: 'b' })).toBeUndefined();
    expect(cache.get({ id: 'a' })?.toString()).toBe('a');
    expect(cache.get({ id: 'c' })?.toString()).toBe('c');
  });

  it('dadas muitas chaves diferentes, quando insere, então o cache nunca passa do teto', () => {
    const { cache } = buildCache({ maxEntries: 3 });
    for (let i = 0; i < 100; i++) cache.set({ id: `k${i}`, key: Buffer.from(`k${i}`) });

    expect(cache.size).toBe(3);
  });
});
