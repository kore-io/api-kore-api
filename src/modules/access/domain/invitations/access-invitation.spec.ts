import {
  canCancel,
  invitationExpiresAt,
  isPendingAt,
  recipientsAllowed,
  roleGrantedBy,
  sendRefusal,
  type InvitationWedding,
} from './access-invitation';

const coupleWedding: InvitationWedding = {
  createdByUserId: 'u-ana',
  createdByReferrer: false,
  activeOwners: 1,
  activeCollaborators: 0,
};
const plannerWedding: InvitationWedding = {
  createdByUserId: 'u-juliana',
  createdByReferrer: true,
  activeOwners: 0,
  activeCollaborators: 1,
};

describe('Convites de acesso: regras do envio', () => {
  it('RN03 - o convite vale 30 dias', () => {
    expect(invitationExpiresAt({ now: new Date('2026-11-01T12:00:00Z') })).toEqual(
      new Date('2026-12-01T12:00:00Z'),
    );
  });

  it('RN01 - parceiro e casal viram donos; o cerimonialista, colaborador', () => {
    expect(roleGrantedBy({ kind: 'partner' })).toBe('owner');
    expect(roleGrantedBy({ kind: 'couple' })).toBe('owner');
    expect(roleGrantedBy({ kind: 'planner' })).toBe('collaborator');
  });

  it.each([
    ['partner', ['a@x.com'], true],
    ['partner', [], false],
    ['partner', ['a@x.com', 'b@x.com'], false],
    ['planner', ['a@x.com', 'b@x.com'], false],
    ['couple', [], true],
    ['couple', ['a@x.com', 'b@x.com'], true],
    ['couple', ['a@x.com', 'A@x.com'], false],
  ] as const)('RN01 e RN14 - %s com %j: %s', (kind, emails, allowed) => {
    expect(recipientsAllowed({ kind, emails })).toBe(allowed);
  });

  it('RN02 - o dono convida o parceiro enquanto há menos de 2 donos', () => {
    const send = (activeOwners: number) =>
      sendRefusal({
        kind: 'partner',
        senderId: 'u-ana',
        senderRole: 'owner',
        wedding: { ...coupleWedding, activeOwners },
      });
    expect(send(1)).toBeNull();
    expect(send(2)).toBe('owners_full');
  });

  it('RN02 - o dono convida o cerimonialista enquanto o casamento não tem cerimonialista', () => {
    const send = (activeCollaborators: number) =>
      sendRefusal({
        kind: 'planner',
        senderId: 'u-ana',
        senderRole: 'owner',
        wedding: { ...coupleWedding, activeCollaborators },
      });
    expect(send(0)).toBeNull();
    expect(send(1)).toBe('planner_already');
  });

  it('RN02 - o colaborador não convida parceiro nem cerimonialista', () => {
    expect(
      sendRefusal({
        kind: 'partner',
        senderId: 'u-j',
        senderRole: 'collaborator',
        wedding: coupleWedding,
      }),
    ).toBe('action_not_allowed');
  });

  it('RN02 - o do casal, só o indicador que criou, enquanto o casal não aceitou', () => {
    const send = (senderId: string, wedding: InvitationWedding) =>
      sendRefusal({ kind: 'couple', senderId, senderRole: 'collaborator', wedding });
    expect(send('u-juliana', plannerWedding)).toBeNull();
    expect(send('u-outra', plannerWedding)).toBe('action_not_allowed');
    expect(send('u-juliana', { ...plannerWedding, activeOwners: 1 })).toBe('action_not_allowed');
    expect(send('u-ana', coupleWedding)).toBe('action_not_allowed');
  });

  it('RN05 - quem enviou, ou um dono, cancela', () => {
    expect(canCancel({ invitedByUserId: 'u-j', userId: 'u-j', role: 'collaborator' })).toBe(true);
    expect(canCancel({ invitedByUserId: 'u-ana', userId: 'u-marcos', role: 'owner' })).toBe(true);
    expect(canCancel({ invitedByUserId: 'u-ana', userId: 'u-j', role: 'collaborator' })).toBe(
      false,
    );
  });

  it('RN05 - aceito, recusado, cancelado, substituído ou vencido não está pendente', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const base = {
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
      supersededAt: null,
      expiresAt: new Date('2026-11-20T00:00:00Z'),
    };
    expect(isPendingAt({ invitation: base, now })).toBe(true);
    expect(isPendingAt({ invitation: { ...base, revokedAt: now }, now })).toBe(false);
    expect(isPendingAt({ invitation: { ...base, supersededAt: now }, now })).toBe(false);
    expect(isPendingAt({ invitation: { ...base, expiresAt: now }, now })).toBe(false);
  });
});
