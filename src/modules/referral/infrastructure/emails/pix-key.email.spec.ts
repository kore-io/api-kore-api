import {
  formatDayAndHour,
  pixKeyChangeCanceledEmail,
  pixKeyChangeConfirmedEmail,
  pixKeyConfirmEmail,
} from './pix-key.email';

const NOT_YOU = 'Se não foi você, cancele a troca no Kore ou escreva para suporte@kore.com.br.';

describe('Os e-mails da chave Pix (Repasse RN03; decisão 244(1))', () => {
  it('decisão 244(1) - a data e a hora de São Paulo: "28 de set. às 14h"', () => {
    expect(formatDayAndHour(new Date('2026-09-28T17:00:00Z'))).toBe('28 de set. às 14h');
    expect(formatDayAndHour(new Date('2026-09-28T17:30:00Z'))).toBe('28 de set. às 14h30');
  });

  it('decisão 244(1) - o link: assunto da primeira chave e da troca, a máscara e os 30 minutos', () => {
    const first = pixKeyConfirmEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      firstKey: true,
      keyMasked: 'jul***@pradoassessoria.com.br',
      url: 'http://app/dados-para-receber/confirmar?token=t',
    });
    expect(first.subject).toBe('Confirme a sua chave Pix');
    expect(first.text).toContain('Olá, Juliana!');
    expect(first.text).toContain(
      'Para confirmar a chave Pix jul***@pradoassessoria.com.br, abra o link abaixo. Ele vale por 30 minutos.',
    );
    expect(first.text).toContain(
      'Confirmar chave Pix: http://app/dados-para-receber/confirmar?token=t',
    );
    expect(first.text).toContain(NOT_YOU);
    expect(
      pixKeyConfirmEmail({
        to: 'j@kore.local',
        firstName: null,
        firstKey: false,
        keyMasked: 'x',
        url: 'u',
      }).subject,
    ).toBe('Confirme a troca da chave Pix');
  });

  it('decisão 244(1) - a troca confirmada (com a data) e a cancelada', () => {
    const confirmed = pixKeyChangeConfirmedEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      activeFrom: new Date('2026-09-28T17:00:00Z'),
      url: 'u',
    });
    expect(confirmed.subject).toBe('Troca da chave Pix confirmada');
    expect(confirmed.text).toContain('A nova chave vale a partir de 28 de set. às 14h.');
    const canceled = pixKeyChangeCanceledEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      url: 'u',
    });
    expect(canceled.subject).toBe('Troca da chave Pix cancelada');
    expect(canceled.text).toContain('A chave atual continua valendo.');
    expect(canceled.text).toContain(NOT_YOU);
  });
});
