import {
  coupleNames,
  emailDiffers,
  invalidReason,
  partnerChoice,
  referralCodeCandidates,
  type InvitationPartner,
} from './invitation-acceptance';

const now = new Date('2026-11-10T00:00:00Z');
const pending = {
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  supersededAt: null,
  expiresAt: new Date('2026-12-01T00:00:00Z'),
};
const partners: InvitationPartner[] = [
  { slot: 2, displayName: 'Marcos Rocha', title: null, userId: null },
  { slot: 1, displayName: 'Ana Beatriz', title: 'bride', userId: 'u-ana' },
];

describe('Convites de acesso: regras do aceite', () => {
  it('RN03 e RN12 - motivo do convite inválido (aceito ou recusado conta como usado, decisão 172)', () => {
    expect(invalidReason({ invitation: pending, now })).toBeNull();
    expect(invalidReason({ invitation: { ...pending, acceptedAt: now }, now })).toBe('used');
    expect(invalidReason({ invitation: { ...pending, declinedAt: now }, now })).toBe('used');
    expect(invalidReason({ invitation: { ...pending, revokedAt: now }, now })).toBe('revoked');
    expect(invalidReason({ invitation: { ...pending, supersededAt: now }, now })).toBe(
      'superseded',
    );
    expect(invalidReason({ invitation: { ...pending, expiresAt: now }, now })).toBe('expired');
  });

  it('RN07 - compara o e-mail sem diferenciar maiúsculas; o link sem e-mail não compara', () => {
    expect(emailDiffers({ invitationEmail: 'Ana@X.com', sessionEmail: 'ana@x.com' })).toBe(false);
    expect(emailDiffers({ invitationEmail: 'ana@x.com', sessionEmail: 'bia@x.com' })).toBe(true);
    expect(emailDiffers({ invitationEmail: null, sessionEmail: 'bia@x.com' })).toBe(false);
  });

  it('decisão 168 (7) - os primeiros nomes dos noivos, pela ordem', () => {
    expect(coupleNames({ partners })).toBe('Ana & Marcos');
  });

  it('RN14 e decisão 172 (1) - no do casal, a pessoa escolhe o nome e o título', () => {
    expect(partnerChoice({ kind: 'couple', partners, partnerIndex: 2, myTitle: 'groom' })).toEqual({
      slot: 2,
      title: 'groom',
    });
    expect(partnerChoice({ kind: 'couple', partners, partnerIndex: null, myTitle: 'groom' })).toBe(
      'missing',
    );
  });

  it('decisão 172 (2) - no do parceiro, o noivo sem login; o título só se ele ainda não tiver', () => {
    expect(partnerChoice({ kind: 'partner', partners, partnerIndex: null, myTitle: null })).toBe(
      'missing',
    );
    expect(
      partnerChoice({ kind: 'partner', partners, partnerIndex: null, myTitle: 'groom' }),
    ).toEqual({
      slot: 2,
      title: 'groom',
    });
    const titled = partners.map((partner) => ({
      ...partner,
      title: partner.title ?? ('groom' as const),
    }));
    expect(
      partnerChoice({ kind: 'partner', partners: titled, partnerIndex: null, myTitle: 'bride' }),
    ).toEqual({
      slot: 2,
      title: null,
    });
    const full = partners.map((partner) => ({ ...partner, userId: partner.userId ?? 'u-marcos' }));
    expect(
      partnerChoice({ kind: 'partner', partners: full, partnerIndex: null, myTitle: 'groom' }),
    ).toBe('taken');
    expect(
      partnerChoice({ kind: 'planner', partners, partnerIndex: null, myTitle: null }),
    ).toBeNull();
  });

  it('decisão 135 (6) - código de indicação: slug do nome, sem acento, com sufixo se repetir', () => {
    const codes = referralCodeCandidates({ name: '  Júlia  D’Ávila Prado ' });
    expect([codes.next().value, codes.next().value, codes.next().value]).toEqual([
      'julia-d-avila-prado',
      'julia-d-avila-prado-2',
      'julia-d-avila-prado-3',
    ]);
    expect(referralCodeCandidates({ name: '!!!' }).next().value).toBe('cerimonialista');
  });
});
