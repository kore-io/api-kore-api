import { declineNoticeEmail } from './decline-notice.email';

const url = 'http://localhost:5173/app';
const base = {
  to: 'ana@x.com',
  inviterName: 'Ana',
  partnerNames: ['Fernanda', 'João'] as [string, string],
  inviterIsOwner: true,
};

describe('E-mail 5 da Voz & Microcopy: aviso de convite recusado (RN11)', () => {
  it('parceiro: assunto com o nome, texto e botão Abrir o Kore', () => {
    const email = declineNoticeEmail({
      notice: { ...base, kind: 'partner', declinedBy: 'Marcos' },
      url,
    });

    expect(email.subject).toBe('Marcos recusou o convite');
    expect(email.text).toContain('Olá, Ana.');
    expect(email.text).toContain('Marcos recusou o convite para o casamento de vocês no Kore.');
    expect(email.text).toContain('Se foi engano, envie um convite novo em Colaboradores.');
    expect(email.text).toContain(`Abrir o Kore: ${url}`);
    expect(email.text).toContain('Você recebeu este e-mail porque convidou Marcos no Kore.');
  });

  it('casal: o e-mail convidado e os nomes do casal', () => {
    const email = declineNoticeEmail({
      notice: {
        ...base,
        kind: 'couple',
        declinedBy: 'fernanda.alves@gmail.com',
        inviterIsOwner: false,
      },
      url,
    });

    expect(email.text).toContain(
      'fernanda.alves@gmail.com recusou o convite para o casamento de Fernanda e João.',
    );
    expect(email.text).toContain(
      'Você pode reenviar o convite ou convidar outro e-mail no detalhe do casamento.',
    );
  });

  it('cerimonialista', () => {
    const email = declineNoticeEmail({
      notice: { ...base, kind: 'planner', declinedBy: 'Juliana' },
      url,
    });

    expect(email.text).toContain(
      'Juliana recusou o convite para ser cerimonialista do casamento de vocês.',
    );
    expect(email.text).toContain('Você pode convidar outra pessoa em Colaboradores.');
  });
});
