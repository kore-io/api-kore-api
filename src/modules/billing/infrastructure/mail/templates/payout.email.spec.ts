import { payoutPaidEmail, payoutRejectedEmail } from './payout.email';

describe('Os e-mails do repasse (Repasse RN07 e RN08; textos da Pena, decisão 302(3)(4))', () => {
  it('RN08 e decisão 302(4) - "Repasse pago": só e-mail, sem valor, o comprovante em Repasses', () => {
    const message = payoutPaidEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      url: 'http://app/cerimonialista/comissoes',
    });
    expect(message.subject).toBe('Repasse pago');
    expect(message.html).toContain('O Pix foi enviado para sua chave.');
    expect(message.text.split('\n\n').slice(0, 3)).toEqual([
      'Olá, Juliana.',
      'O Kore pagou seu repasse por Pix. O comprovante está em Repasses, no Kore.',
      'Ver repasses: http://app/cerimonialista/comissoes',
    ]);
    expect(message.text).not.toMatch(/R\$/);
  });

  it('RN07, RN08 e decisão 302(4) - "Repasse recusado": o motivo em Repasses, sem valor', () => {
    const message = payoutRejectedEmail({ to: 'j@kore.local', firstName: 'Juliana', url: 'u' });
    expect(message.subject).toBe('Repasse recusado');
    expect(message.html).toContain('Suas comissões voltaram ao saldo.');
    expect(message.text.split('\n\n').slice(0, 3)).toEqual([
      'Olá, Juliana.',
      'Seu pedido de repasse foi recusado. Veja o motivo em Repasses: as comissões voltaram ao saldo disponível, e você pode pedir de novo agora.',
      'Ver repasses: u',
    ]);
    expect(message.text).not.toMatch(/R\$/);
  });

  it('decisão 302(3) - sem nome, "Olá!"', () => {
    const message = payoutRejectedEmail({ to: 'j@kore.local', firstName: null, url: 'u' });
    expect(message.text.split('\n\n')[0]).toBe('Olá!');
  });
});
