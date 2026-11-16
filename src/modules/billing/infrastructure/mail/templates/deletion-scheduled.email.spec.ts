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

describe('deletionScheduledEmail (Retenção e expurgo RN05; decisão 252)', () => {
  it('RN05 - o outro dono: "Ana pediu…" e "Se ninguém do casal pediu…"', () => {
    const message = deletionScheduledEmail({ notice, url });
    expect(message.subject).toBe('O casamento será apagado em 7 dias');
    expect(message.html).toContain('Até 21 de nov., dá para cancelar.');
    expect(message.text).toContain('Olá, Marcos!');
    expect(message.text).toContain(
      'Ana pediu para excluir o casamento no Kore. O site saiu do ar, e os convidados, as respostas e o site serão apagados em 21 de nov.',
    );
    expect(message.text).toContain(`Cancelar a exclusão: ${url}`);
    expect(message.text).toContain(
      'Se ninguém do casal pediu, cancele agora e escreva para suporte@kore.com.br.',
    );
  });

  it('RN05 (decisão 252) - quem pediu: "Você pediu…" e "Se não foi você…"', () => {
    const message = deletionScheduledEmail({
      notice: { ...notice, to: 'ana@example.com', firstName: 'Ana', isRequester: true },
      url,
    });
    expect(message.subject).toBe('O casamento será apagado em 7 dias');
    expect(message.text).toContain('Olá, Ana!');
    expect(message.text).toContain('Você pediu para excluir o casamento no Kore.');
    expect(message.text).toContain(
      'Se não foi você, cancele agora e escreva para suporte@kore.com.br.',
    );
    expect(message.text).not.toContain('Se ninguém do casal pediu');
  });
});
