import {
  endDateSoonEmail,
  formatDay,
  formatPrice,
  graceEmail,
  paymentConfirmedEmail,
  siteExpiredEmail,
  pixExpiredEmail,
  refundCompletedEmail,
} from './billing.email';

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

describe('E-mail do Pix vencido (Publicar e pagar RN11 e RN13; textos da Pena)', () => {
  const email = pixExpiredEmail({
    notice: { to: 'ana@kore.local', partnerNames: ['Ana', 'Marcos'] },
    url: 'http://localhost:5173/app/cobranca',
  });

  it('RN13 - assunto, pré-cabeçalho, corpo e botão da Pena, sem valor', () => {
    expect(email.subject).toBe('O código Pix venceu');
    expect(email.html).toContain('O site continua em rascunho.');
    expect(email.text).toContain(
      'O código Pix para publicar o site venceu antes do pagamento. Gerem um novo para publicar.',
    );
    expect(email.text).toContain('Gerar novo Pix: http://localhost:5173/app/cobranca');
    expect(email.text).toContain('Dúvidas? Escreva para suporte@kore.com.br.');
    expect(email.text).not.toMatch(/R\$/);
  });
});

describe('E-mail do reembolso concluído (Pagamentos e arrependimento RN07; textos da Pena)', () => {
  const email = refundCompletedEmail({
    notice: { to: 'ana@kore.local', firstName: 'Ana', partnerNames: ['Ana', 'Marcos'] },
    url: 'http://localhost:5173/app/cobranca',
  });

  it('RN07 - assunto, pré-cabeçalho, corpo e botão da Pena, sem valor', () => {
    expect(email.subject).toBe('Reembolso concluído');
    expect(email.html).toContain('O valor foi devolvido pela mesma forma de pagamento.');
    expect(email.text).toContain('Olá, Ana!');
    expect(email.text).toContain(
      'O reembolso foi concluído. O valor foi devolvido pela mesma forma de pagamento: no cartão, ele aparece numa das próximas faturas.',
    );
    expect(email.text).toContain('Ver pagamentos: http://localhost:5173/app/cobranca');
    expect(email.text).toContain('Dúvidas? Escreva para suporte@kore.com.br.');
    expect(email.text).not.toMatch(/R\$/);
  });
});

describe('Os avisos de saída do ar (Data de saída do ar RN03; textos da Pena)', () => {
  const url = 'http://localhost:5173/app/cobranca';
  const partnerNames: [string, string] = ['Ana', 'Marcos'];

  it('RN03 - antes da data: assunto, pré-cabeçalho, corpo com o preço da regra e Adiar a data', () => {
    const email = endDateSoonEmail({
      notice: {
        to: 'ana@kore.local',
        firstName: 'Ana',
        endDate: '2027-02-14',
        monthlyCents: 2900,
        partnerNames,
      },
      url,
    });
    expect(email.subject).toBe('O site fica no ar até 14 de fev.');
    expect(email.html).toContain('Adiem a data para mantê-lo no ar.');
    expect(email.text).toContain('Olá, Ana!');
    expect(email.text).toContain(
      'O site de vocês fica no ar até 14 de fev. Depois dessa data, ele fica mais 7 dias no ar e então sai do ar.',
    );
    expect(email.text).toContain('Para manter o site, adiem a data. Cada mês a mais custa R$ 29.');
    expect(email.text).toContain(`Adiar a data: ${url}`);
  });

  it('RN03 - 1º e 5º dia: o último dia no ar, sem a palavra carência', () => {
    const email = graceEmail({
      notice: { to: 'ana@kore.local', graceUntil: '2027-02-21', partnerNames },
      url,
    });
    expect(email.subject).toBe('O site sai do ar depois de 21 de fev.');
    expect(email.html).toContain('A data de saída do ar passou.');
    expect(email.text).toContain(
      'A data de saída do ar passou, e o site fica no ar só até 21 de fev. Depois, os convidados não conseguem mais abrir o site.',
    );
    expect(email.text).toContain(`Adiar a data: ${url}`);
    expect(email.text.toLowerCase()).not.toContain('carência');
  });

  it('RN03 - expirado: desde quando e até quando renovar, com Renovar', () => {
    const email = siteExpiredEmail({
      notice: {
        to: 'ana@kore.local',
        expiredAt: '2027-02-22',
        renewUntil: '2027-11-14',
        partnerNames,
      },
      url,
    });
    expect(email.subject).toBe('O site saiu do ar');
    expect(email.html).toContain('Renovem para os convidados voltarem a vê-lo.');
    expect(email.text).toContain(
      'O site de vocês saiu do ar em 22 de fev. Os dados continuam guardados, e vocês podem renovar até 14 de nov. de 2027.',
    );
    expect(email.text).toContain(`Renovar: ${url}`);
    expect(email.text).not.toMatch(/R\$/);
  });

  it('formatPrice - sem centavos quando redondo', () => {
    expect(formatPrice(2900)).toBe('R$ 29');
    expect(formatPrice(2990)).toBe('R$ 29,90');
  });
});
