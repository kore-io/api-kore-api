import { uuidV7 } from './uuid-v7';

describe('uuidV7', () => {
  it('gera UUID versão 7, variante RFC, com o instante nos 48 bits iniciais', () => {
    const now = Date.parse('2026-11-06T10:00:00Z');
    const id = uuidV7({ now });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('ordena pelo tempo', () => {
    expect(uuidV7({ now: 1000 }) < uuidV7({ now: 2000 })).toBe(true);
  });
});
