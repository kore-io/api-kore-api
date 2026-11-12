import { coupleAcceptedEmail, plannerLeftEmail } from './collaboration-notices.email';

describe('E-mails da RN09 de Notificações da cerimonialista (textos da Pena)', () => {
  const left = {
    to: 'ana@kore.local',
    ownerName: 'Ana',
    plannerName: 'Juliana Prado',
    agencyName: 'Prado Assessoria',
    partnerNames: ['Ana', 'Marcos'] as [string, string],
  };

  it('RN09 - a cerimonialista saiu: assunto pela assessoria, o nome dela com a assessoria entre parênteses', () => {
    const email = plannerLeftEmail({ notice: left, url: 'http://app/app' });

    expect(email.to).toBe('ana@kore.local');
    expect(email.subject).toBe('Prado Assessoria saiu do casamento de vocês');
    expect(email.text).toBe(
      [
        'Olá, Ana.',
        'Juliana Prado (Prado Assessoria) saiu do casamento de Ana e Marcos no Kore. O site e a lista continuam como estão, e a assinatura da assessoria saiu do rodapé do site.',
        'Se quiserem, convidem outra pessoa em Colaboradores.',
        'Abrir Colaboradores: http://app/app',
        'Dúvidas? Escreva para suporte@kore.com.br.',
        'Você recebeu este e-mail porque o casamento de Ana e Marcos é seu no Kore.',
      ].join('\n\n'),
    );
    expect(email.html).toContain('O site e a lista continuam como estão.');
  });

  it('RN09 - quando o nome da assessoria é o próprio nome dela, os parênteses saem', () => {
    const email = plannerLeftEmail({
      notice: { ...left, agencyName: 'Juliana Prado' },
      url: 'http://app/app',
    });

    expect(email.subject).toBe('Juliana Prado saiu do casamento de vocês');
    expect(email.text).toContain('\n\nJuliana Prado saiu do casamento de Ana e Marcos no Kore.');
  });

  it('RN09 - o casal aceitou: o casal no assunto e o botão para o detalhe do casamento', () => {
    const email = coupleAcceptedEmail({
      notice: {
        to: 'juliana@kore.local',
        plannerName: 'Juliana',
        partnerNames: ['Fernanda', 'João'],
        weddingId: 'w1',
      },
      url: 'http://app/cerimonialista/casamentos/w1',
    });

    expect(email.subject).toBe('Fernanda e João aceitaram o convite');
    expect(email.text).toBe(
      [
        'Olá, Juliana.',
        'Fernanda e João aceitaram o convite. O casal assumiu o casamento, e você continua colaborando no site e na lista.',
        'Abrir o casamento: http://app/cerimonialista/casamentos/w1',
        'Dúvidas? Escreva para suporte@kore.com.br.',
        'Você recebeu este e-mail porque criou este casamento no Kore.',
      ].join('\n\n'),
    );
    expect(email.html).toContain('Você continua colaborando no site e na lista.');
  });
});
