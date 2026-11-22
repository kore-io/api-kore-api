import { deletionScheduledEmail } from './billing.email';

const notice = {
  to: 'marcos@example.com',
  firstName: 'Marcos',
  requesterFirstName: 'Ana',
  deletionScheduledFor: '2026-11-21',
  partnerNames: ['Ana', 'Marcos'] as [string, string],
  isRequester: false,
};
const url = 'https://app.kore.com.br/app/configuracoes/casamento';

/** Os textos da Pena na spec, com a decisão 264(A): saudação com ponto e a data com o ano. */
describe('deletionScheduledEmail (Retenção e expurgo RN05; decisões 252 e 264(A))', () => {
  it('RN05 - o outro dono: "Olá, Marcos.", "Ana pediu…" com a data e o ano, e "Se ninguém do casal pediu…"', () => {
    const message = deletionScheduledEmail({ notice, url });
    expect(message.subject).toBe('O casamento será apagado em 7 dias');
    expect(message.html).toContain('Até 21 de nov., dá para cancelar.');
    expect(message.text).toContain('Olá, Marcos.');
    expect(message.text).not.toContain('Olá, Marcos!');
    expect(message.text).toContain(
      'Ana pediu para excluir o casamento no Kore. O site saiu do ar, e os convidados, as respostas e o site serão apagados em 21 de nov. de 2026.',
    );
    expect(message.text).toContain('Se mudarem de ideia, cancelem a exclusão até lá.');
    expect(message.text).toContain(`Cancelar a exclusão: ${url}`);
    expect(message.text).toContain(
      'Se ninguém do casal pediu, cancele agora e escreva para suporte@kore.com.br.',
    );
  });

  it('RN05 (decisões 252 e 264(A)) - quem pediu: a versão dela, no singular', () => {
    const message = deletionScheduledEmail({
      notice: { ...notice, to: 'ana@example.com', firstName: 'Ana', isRequester: true },
      url,
    });
    expect(message.subject).toBe('O casamento será apagado em 7 dias');
    expect(message.html).toContain('Até 21 de nov., dá para cancelar.');
    expect(message.text).toContain('Olá, Ana.');
    expect(message.text).toContain(
      'Você pediu para excluir o casamento no Kore. O site já saiu do ar. Os convidados, as respostas e o site serão apagados em 21 de nov. de 2026.',
    );
    expect(message.text).toContain('Se mudar de ideia, cancele a exclusão até lá.');
    expect(message.text).not.toContain('Se mudarem de ideia');
    expect(message.text).toContain(
      'Se não foi você, cancele a exclusão agora e escreva para suporte@kore.com.br.',
    );
    expect(message.text).not.toContain('Se ninguém do casal pediu');
  });
});
