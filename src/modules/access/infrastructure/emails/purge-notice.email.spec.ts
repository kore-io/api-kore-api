import { purgeNoticeEmail } from './purge-notice.email';

const notice = {
  to: 'juliana@x.com',
  creatorName: 'Juliana',
  partnerNames: ['Fernanda', 'João'] as [string, string],
  status: 'awaiting_couple' as const,
  purgeDate: new Date('2026-12-14T15:00:00Z'),
};
const url = 'http://localhost:5173/perfis';

describe('E-mail 6 da Voz & Microcopy: aviso de exclusão em 30 dias (RN13)', () => {
  it('aguardando o casal: assunto, a data e o botão', () => {
    const email = purgeNoticeEmail({ notice, url });

    expect(email.subject).toBe('O casamento de Fernanda e João será excluído em 30 dias');
    expect(email.text).toContain('Olá, Juliana.');
    expect(email.text).toContain(
      'O casamento de Fernanda e João está sem atividade há 5 meses, e o casal ainda não aceitou o convite.',
    );
    expect(email.text).toContain(
      'Se continuar assim, ele será excluído em 14 de dez. de 2026, com tudo o que você preparou. Não dá para desfazer.',
    );
    expect(email.text).toContain(`Abrir o casamento: ${url}`);
    expect(email.text).toContain('Você recebeu este e-mail porque criou este casamento no Kore.');
  });

  it('rascunho sem dono: o convite ainda não foi enviado', () => {
    expect(purgeNoticeEmail({ notice: { ...notice, status: 'draft' }, url }).text).toContain(
      'e o convite para o casal ainda não foi enviado.',
    );
  });
});
