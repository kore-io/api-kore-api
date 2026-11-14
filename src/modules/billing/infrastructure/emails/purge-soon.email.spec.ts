import { purgeSoonEmail } from './billing.email';

describe('purgeSoonEmail (Retenção e expurgo RN02; textos da Pena)', () => {
  it('RN02 - assunto, pré-cabeçalho, as datas sem o ano e os dois botões', () => {
    const message = purgeSoonEmail({
      notice: {
        to: 'ana@example.com',
        firstName: 'Ana',
        weddingId: 'w',
        noticeSentAt: new Date('2027-07-23T06:30:00Z'),
        purgeAt: '2027-08-22',
        expiredAt: '2027-02-22',
        partnerNames: ['Ana', 'Marcos'],
      },
      renewUrl: 'https://app.kore.com.br/app/cobranca',
      exportUrl: 'https://app.kore.com.br/app/convidados/exportar',
    });
    expect(message.subject).toBe('Os dados do casamento serão apagados em 30 dias');
    expect(message.html).toContain('Renovem o site ou exportem os convidados antes de 22 de ago.');
    expect(message.text).toContain('Olá, Ana!');
    expect(message.text).toContain(
      'O site de vocês está fora do ar desde 22 de fev. Em 22 de ago., os convidados, as respostas e o site serão apagados.',
    );
    expect(message.text).toContain('Renovar: https://app.kore.com.br/app/cobranca');
    expect(message.text).toContain(
      'Exportar os convidados: https://app.kore.com.br/app/convidados/exportar',
    );
  });
});
