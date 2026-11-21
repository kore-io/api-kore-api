import {
  formatDayAndHour,
  pixKeyChangeCanceledEmail,
  pixKeyChangeConfirmedEmail,
  pixKeyConfirmEmail,
} from './pix-key.email';

const SUPPORT = 'Dúvidas? Escreva para suporte@kore.com.br.';

describe('Os e-mails da chave Pix (Repasse RN03; decisões 244(1) e 302(2)(3))', () => {
  it('decisão 244(1) - a data e a hora de São Paulo: "28 de set. às 14h"', () => {
    expect(formatDayAndHour(new Date('2026-09-28T17:00:00Z'))).toBe('28 de set. às 14h');
    expect(formatDayAndHour(new Date('2026-09-28T17:30:00Z'))).toBe('28 de set. às 14h30');
  });

  it('decisão 302(2) - a primeira chave: assunto, "use o botão", não use o botão e o rodapé neutro', () => {
    const first = pixKeyConfirmEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      firstKey: true,
      keyMasked: 'jul***@pradoassessoria.com.br',
      url: 'http://app/dados-para-receber/confirmar?token=t',
    });
    expect(first.subject).toBe('Confirme sua chave Pix');
    expect(first.text.split('\n\n')).toEqual([
      'Olá, Juliana.',
      'Para confirmar a chave Pix jul***@pradoassessoria.com.br, use o botão abaixo. Ele vale por 30 minutos.',
      'Confirmar chave Pix: http://app/dados-para-receber/confirmar?token=t',
      'Se não foi você, não use o botão e escreva para suporte@kore.com.br.',
      SUPPORT,
      'Você recebeu este e-mail porque uma chave Pix foi cadastrada na sua conta do Kore.',
    ]);
    expect(first.html).toContain('O link vale por 30 minutos.');
    expect(first.html).not.toContain('cancele a troca');
  });

  it('decisão 302(2) - a troca pedida: "para a chave", botão Confirmar a troca e Cancele a troca', () => {
    const change = pixKeyConfirmEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      firstKey: false,
      keyMasked: '***.456.789-**',
      url: 'u',
    });
    expect(change.subject).toBe('Confirme a troca da chave Pix');
    expect(change.text.split('\n\n')).toEqual([
      'Olá, Juliana.',
      'Para confirmar a troca para a chave Pix ***.456.789-**, use o botão abaixo. Ele vale por 30 minutos.',
      'Confirmar a troca: u',
      'Se não foi você, não use o botão. Cancele a troca no Kore ou escreva para suporte@kore.com.br.',
      SUPPORT,
      'Você recebeu este e-mail porque a troca da chave Pix foi pedida na sua conta do Kore.',
    ]);
  });

  it('decisão 302(2) - a troca confirmada traz a chave mascarada e a espera; o pré-cabeçalho, não a chave', () => {
    const confirmed = pixKeyChangeConfirmedEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      keyMasked: '***.456.789-**',
      activeFrom: new Date('2026-09-28T17:00:00Z'),
      url: 'u',
    });
    expect(confirmed.subject).toBe('Troca da chave Pix confirmada');
    expect(confirmed.text.split('\n\n')).toEqual([
      'Olá, Juliana.',
      'A nova chave Pix ***.456.789-** vale a partir de 28 de set. às 14h. Até lá, os repasses ficam em espera.',
      'Ver dados para receber: u',
      'Se não foi você, cancele a troca no Kore ou escreva para suporte@kore.com.br.',
      SUPPORT,
      'Você recebeu este e-mail porque a troca da chave Pix foi pedida na sua conta do Kore.',
    ]);
    expect(confirmed.html).toContain('Até lá, os repasses ficam em espera.');
    expect(confirmed.subject).not.toContain('***');
  });

  it('decisão 302(2) - a troca cancelada: sem "cancele a troca", rodapé do cancelamento', () => {
    const canceled = pixKeyChangeCanceledEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      url: 'u',
    });
    expect(canceled.subject).toBe('Troca da chave Pix cancelada');
    expect(canceled.text.split('\n\n')).toEqual([
      'Olá, Juliana.',
      'A chave atual continua valendo.',
      'Ver dados para receber: u',
      'Se não foi você, escreva para suporte@kore.com.br.',
      SUPPORT,
      'Você recebeu este e-mail porque a troca da chave Pix foi cancelada na sua conta do Kore.',
    ]);
  });

  it('decisão 302(3) - sem nome, "Olá!"', () => {
    const canceled = pixKeyChangeCanceledEmail({ to: 'j@kore.local', firstName: null, url: 'u' });
    expect(canceled.text.split('\n\n')[0]).toBe('Olá!');
  });
});
