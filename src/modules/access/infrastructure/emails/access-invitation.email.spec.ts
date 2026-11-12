import type { InvitationEmail } from '../../application/ports/invitation-mailer.port';
import { accessInvitationEmail } from './access-invitation.email';

const wedding = {
  status: 'draft',
  createdByUserId: 'u',
  createdByReferrer: false,
  activeOwners: 1,
  activeCollaborators: 0,
  partnerNames: ['Ana Beatriz Moreira', 'Marcos Rocha'] as [string, string],
  eventDate: new Date('2027-03-20T00:00:00Z'),
  city: 'Valinhos',
  state: 'SP',
};
const base: InvitationEmail = {
  kind: 'partner',
  to: 'marcos@x.com',
  token: 'tok',
  resent: false,
  message: null,
  wedding,
  inviter: {
    partnerName: 'Ana Beatriz Moreira',
    userName: 'Ana',
    referrerKind: null,
    creditName: null,
  },
};
const url = 'http://localhost:5173/convite/tok';

describe('E-mails de convite de acesso (Voz & Microcopy, e-mails 2 a 4)', () => {
  it('e-mail 2 - parceiro: assunto, data e cidade, botão e validade; o link fora do assunto', () => {
    const email = accessInvitationEmail({ email: base, url });

    expect(email.subject).toBe('Ana convidou você para o casamento no Kore');
    expect(email.text).toContain(
      'Ana convidou você para organizar o casamento de Ana e Marcos no Kore.',
    );
    expect(email.text).toContain('sáb., 20 de mar. de 2027 · Valinhos (SP)');
    expect(email.text).toContain(`Ver o convite: ${url}`);
    expect(email.text).toContain('O convite vale por 30 dias e só pode ser usado uma vez.');
    expect(email.text).toContain(
      'Você recebeu este e-mail porque Ana convidou este endereço no Kore.',
    );
    expect(email.subject).not.toContain('tok');
    expect(email.text).not.toContain('Este é um convite novo.');
  });

  it('RN04 - no reenvio, avisa que o link anterior deixou de funcionar; sem data, só a cidade', () => {
    const email = accessInvitationEmail({
      email: { ...base, resent: true, wedding: { ...wedding, eventDate: null } },
      url,
    });

    expect(email.text).toContain('Este é um convite novo. O link do anterior deixou de funcionar.');
    expect(email.text).toContain('\n\nValinhos (SP)\n\n');
  });

  it('e-mail 3 - casal pelo cerimonialista: nome da assessoria e "continua ajudando"', () => {
    const email = accessInvitationEmail({
      email: {
        ...base,
        kind: 'couple',
        inviter: {
          partnerName: null,
          userName: 'Juliana Prado',
          referrerKind: 'planner',
          creditName: 'Prado Assessoria',
        },
      },
      url,
    });

    expect(email.subject).toBe('Prado Assessoria preparou o site do casamento de vocês');
    expect(email.text).toContain('Prado Assessoria continua ajudando no site e na lista.');
    expect(email.text).toContain(`Ver o site e o convite: ${url}`);
  });

  it('e-mail 3 - casal pelo vendedor: "{nome}, do Kore," e sem "continua ajudando" (decisão 136)', () => {
    const email = accessInvitationEmail({
      email: {
        ...base,
        kind: 'couple',
        inviter: {
          partnerName: null,
          userName: 'Lucas Lima',
          referrerKind: 'seller',
          creditName: null,
        },
      },
      url,
    });

    expect(email.subject).toBe('Lucas, do Kore, preparou o site do casamento de vocês');
    expect(email.text).not.toContain('continua ajudando');
  });

  it('e-mail 4 - cerimonialista, com a mensagem de quem convidou citada (decisão 168), escapada no HTML', () => {
    const email = accessInvitationEmail({
      email: { ...base, kind: 'planner', to: 'juliana@x.com', message: 'Vem com a gente <3' },
      url,
    });

    expect(email.subject).toBe('Ana e Marcos convidaram você como cerimonialista');
    expect(email.text).toContain('“Vem com a gente <3”');
    expect(email.html).toContain('Vem com a gente &lt;3');
    expect(email.html).not.toContain('<3');
  });
});
