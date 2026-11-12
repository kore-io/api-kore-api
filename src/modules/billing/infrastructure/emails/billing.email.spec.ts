import { formatDay, paymentConfirmedEmail } from './billing.email';

describe('E-mail de pagamento confirmado (Publicar e pagar RN13; textos da Pena)', () => {
  const email = paymentConfirmedEmail({
    notice: {
      to: 'ana@kore.local',
      firstName: 'Ana',
      endDate: '2027-02-14',
      partnerNames: ['Ana', 'Marcos'],
    },
    url: 'http://localhost:5173/app/cobranca',
  });

  it('RN13 - assunto, pré-cabeçalho e corpo da Pena', () => {
    expect(email.subject).toBe('Pagamento confirmado. O site está no ar');
    expect(email.html).toContain('Ele fica no ar até 14 de fev. de 2027.');
    expect(email.text).toContain('Olá, Ana!');
    expect(email.text).toContain(
      'O pagamento foi confirmado e o site de vocês já está no ar até 14 de fev. de 2027.',
    );
    expect(email.text).toContain('Agora vocês podem enviar os convites.');
    expect(email.text).toContain('Ver pagamentos: http://localhost:5173/app/cobranca');
    expect(email.text).toContain(
      'Vocês podem desistir em até 7 dias depois de pagar, em Pagamentos.',
    );
    expect(email.text).toContain('Dúvidas? Escreva para suporte@kore.com.br.');
  });

  it('D23 - o e-mail não leva valor', () => {
    expect(email.text).not.toMatch(/R\$/);
    expect(email.html).not.toMatch(/R\$/);
  });

  it('formatDay - o dia, sem o fuso mudar a data', () => {
    expect(formatDay('2027-02-14')).toBe('14 de fev. de 2027');
  });
});
