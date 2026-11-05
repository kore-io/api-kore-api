import { applicationLogRetentionCutoff } from './application-log-retention';

describe('Prazo de guarda do log da aplicação (decisão 137)', () => {
  it('dado um instante, quando calcula o corte, então é o mesmo instante 5 anos antes', () => {
    expect(applicationLogRetentionCutoff({ now: new Date('2026-11-05T03:30:00.000Z') })).toEqual(
      new Date('2021-11-05T03:30:00.000Z'),
    );
  });

  it('dado 29 de fevereiro, quando o ano de destino não é bissexto, então usa 28 de fevereiro', () => {
    expect(applicationLogRetentionCutoff({ now: new Date('2028-02-29T12:00:00.000Z') })).toEqual(
      new Date('2023-02-28T12:00:00.000Z'),
    );
  });
});
