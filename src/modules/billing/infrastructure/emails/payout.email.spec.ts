import { payoutPaidEmail, payoutRejectedEmail } from './payout.email';

describe('Os e-mails do repasse (Repasse RN07 e RN08; textos da Pena)', () => {
  it('RN08 - "Repasse pago": só e-mail, sem valor', () => {
    const message = payoutPaidEmail({
      to: 'j@kore.local',
      firstName: 'Juliana',
      url: 'http://app/cerimonialista/comissoes',
    });
    expect(message.subject).toBe('Repasse pago');
    expect(message.html).toContain('O Pix foi enviado para a sua chave.');
    expect(message.text).toContain('Olá, Juliana!');
    expect(message.text).toContain(
      'O Kore pagou o seu repasse por Pix. O comprovante está no Kore.',
    );
    expect(message.text).toContain('Ver repasses: http://app/cerimonialista/comissoes');
    expect(message.text).not.toMatch(/R\$/);
  });

  it('RN07 e RN08 - "Repasse recusado": as comissões voltam ao saldo, sem valor', () => {
    const message = payoutRejectedEmail({ to: 'j@kore.local', firstName: null, url: 'u' });
    expect(message.subject).toBe('Repasse recusado');
    expect(message.html).toContain('Suas comissões voltaram ao saldo.');
    expect(message.text).toContain('Olá!');
    expect(message.text).toContain(
      'O seu pedido de repasse foi recusado. O motivo está no Kore, e as comissões voltaram ao saldo disponível. Você pode pedir de novo agora.',
    );
    expect(message.text).not.toMatch(/R\$/);
  });
});
