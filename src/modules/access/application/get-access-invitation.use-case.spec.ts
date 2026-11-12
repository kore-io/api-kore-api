import type { InvitationSnapshot } from '../domain/invitation-acceptance';
import { inviterOf } from './get-access-invitation.use-case';

const inviter = (overrides: Partial<InvitationSnapshot['inviter']>) =>
  ({
    inviter: {
      userId: 'u',
      email: 'x@x.com',
      name: 'Juliana Prado',
      partnerName: null,
      referrerKind: null,
      creditName: null,
      ...overrides,
    },
  }) as InvitationSnapshot;

describe('Quem convidou, na tela do convite (decisão 168, item 6)', () => {
  it('o dono: o primeiro nome do noivo dele', () => {
    expect(inviterOf({ invitation: inviter({ partnerName: 'Ana Beatriz' }) })).toEqual({
      name: 'Ana',
      role: 'owner',
    });
  });

  it('o cerimonialista: o nome para a assinatura', () => {
    expect(
      inviterOf({
        invitation: inviter({ referrerKind: 'planner', creditName: 'Prado Assessoria' }),
      }),
    ).toEqual({ name: 'Prado Assessoria', role: 'planner' });
  });

  it('o vendedor: o primeiro nome, sem o "do Kore" (que fica no e-mail)', () => {
    expect(
      inviterOf({ invitation: inviter({ referrerKind: 'seller', name: 'Lucas Lima' }) }),
    ).toEqual({
      name: 'Lucas',
      role: 'seller',
    });
  });
});
