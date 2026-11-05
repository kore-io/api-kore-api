import { productEventRetentionCutoff } from './product-event-retention';

describe('Retenção dos eventos de produto (decisão 135)', () => {
  it('dado um instante, quando calcula o corte, então é o mesmo instante 18 meses antes', () => {
    expect(productEventRetentionCutoff({ now: new Date('2026-11-05T05:00:00.000Z') })).toEqual(
      new Date('2025-05-05T05:00:00.000Z'),
    );
  });
});
