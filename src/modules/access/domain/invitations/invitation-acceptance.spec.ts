import {
  coupleNames,
  emailDiffers,
  invalidReason,
  isSelfReferral,
  partnerChoice,
  nextReferralCode,
  referralCodeBase,
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

  it('decisão 135 (6) - código de indicação: slug do nome, sem acento', () => {
    expect(referralCodeBase({ name: '  Júlia  D’Ávila Prado ' })).toBe('julia-d-avila-prado');
    expect(referralCodeBase({ name: '!!!' })).toBe('cerimonialista');
  });

  it('decisão 211 - se repetir, o próximo sufixo numérico livre, sem teto', () => {
    const base = 'ana-silva';
    expect(nextReferralCode({ base, taken: [] })).toBe('ana-silva');
    expect(nextReferralCode({ base, taken: ['ana-silva'] })).toBe('ana-silva-2');
    const many = ['ana-silva', ...Array.from({ length: 59 }, (_, i) => `ana-silva-${i + 2}`)];
    expect(nextReferralCode({ base, taken: many })).toBe('ana-silva-61');
    // Outro nome com o mesmo começo não conta como sufixo.
    expect(nextReferralCode({ base, taken: ['ana-silva', 'ana-silva-prado-7'] })).toBe(
      'ana-silva-2',
    );
    expect(nextReferralCode({ base, taken: ['ana-silva-3'] })).toBe('ana-silva');
  });

  it('decisão 224 (2) e Novo casamento RN05 - autoindicação: o indicador ou quem criou, só no convite do casal', () => {
    const referrer = {
      referrerId: 'r1',
      userId: 'u-juliana',
      referralCode: 'juliana',
      kind: 'planner' as const,
      status: 'active' as const,
      accountStatus: 'active' as const,
      displayName: 'Prado Assessoria',
      referralDiscountEnabled: true,
    };
    const couple = (createdByUserId: string, withReferrer = true) => ({
      kind: 'couple' as const,
      referrer: withReferrer ? referrer : null,
      wedding: { createdByUserId },
    });

    expect(isSelfReferral({ invitation: couple('u-lucas'), userId: 'u-juliana' })).toBe(true);
    expect(isSelfReferral({ invitation: couple('u-lucas', false), userId: 'u-lucas' })).toBe(true);
    expect(isSelfReferral({ invitation: couple('u-lucas'), userId: 'u-f' })).toBe(false);
    // RN10: no convite do cerimonialista, é o indicador quem aceita.
    expect(
      isSelfReferral({
        invitation: { kind: 'planner', referrer, wedding: { createdByUserId: 'u-juliana' } },
        userId: 'u-juliana',
      }),
    ).toBe(false);
  });
});
