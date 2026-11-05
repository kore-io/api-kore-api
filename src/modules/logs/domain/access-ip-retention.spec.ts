import { accessIpRetentionCutoff } from './access-ip-retention';

describe('Prazo de guarda do IP real (decisão 116)', () => {
  it('dado um instante, quando calcula o corte, então é o mesmo instante 6 meses antes', () => {
    expect(accessIpRetentionCutoff({ now: new Date('2026-11-05T03:00:00.000Z') })).toEqual(
      new Date('2026-05-05T03:00:00.000Z'),
    );
  });

  it('dado o fim de agosto, quando o dia não existe em fevereiro, então usa o último dia de fevereiro', () => {
    expect(accessIpRetentionCutoff({ now: new Date('2026-08-31T12:00:00.000Z') })).toEqual(
      new Date('2026-02-28T12:00:00.000Z'),
    );
  });

  it('dado um mês do começo do ano, quando calcula o corte, então volta para o ano anterior', () => {
    expect(accessIpRetentionCutoff({ now: new Date('2027-03-15T00:00:00.000Z') })).toEqual(
      new Date('2026-09-15T00:00:00.000Z'),
    );
  });
});
