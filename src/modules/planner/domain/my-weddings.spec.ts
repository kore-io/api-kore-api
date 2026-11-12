import {
  compareWeddings,
  hasInvitationsNotSentAlert,
  hasPendingResponsesAlert,
  isInvitationsAlertCandidate,
  originOf,
  summaryOf,
  type CollaborationRow,
} from './my-weddings';

const now = new Date('2026-11-12T15:00:00Z'); // 12/11, 12h em São Paulo
const row = (extra: Partial<CollaborationRow> = {}): CollaborationRow => ({
  weddingId: 'w1',
  partnerNames: ['Ana', 'Marcos'],
  eventDate: '2027-01-30',
  city: 'Campinas',
  state: 'SP',
  timezone: 'America/Sao_Paulo',
  status: 'published',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  createdByUserId: 'u-ana',
  referralSource: null,
  referrerUserId: null,
  rsvpDeadline: '2026-11-16',
  stats: { guestsTotal: 120, confirmed: 60, declined: 11, pending: 49, rsvpPercent: 59 },
  ...extra,
});

describe('Meus casamentos e alertas (F6, C2)', () => {
  it('RN02 - a origem: criado por ela, pelo link dela ou convite do casal', () => {
    expect(
      originOf({
        row: row({ referralSource: 'created_by_planner', referrerUserId: 'u-j' }),
        userId: 'u-j',
      }),
    ).toBe('created_by_me');
    expect(
      originOf({
        row: row({ referralSource: 'referral_link', referrerUserId: 'u-j' }),
        userId: 'u-j',
      }),
    ).toBe('referral_link');
    // Pelo link de outra pessoa, ou o convite de cerimonialista: Convite do casal.
    expect(
      originOf({
        row: row({ referralSource: 'referral_link', referrerUserId: 'u-x' }),
        userId: 'u-j',
      }),
    ).toBe('couple_invite');
    expect(
      originOf({
        row: row({ referralSource: 'invited_before_payment', referrerUserId: 'u-j' }),
        userId: 'u-j',
      }),
    ).toBe('couple_invite');
  });

  it('RN02 - a data mais próxima primeiro; sem data, no fim, do mais novo para o mais antigo', () => {
    const rows = [
      row({ weddingId: 'sem-data-velho', eventDate: null, createdAt: new Date('2026-01-01') }),
      row({ weddingId: 'marco', eventDate: '2027-03-20' }),
      row({ weddingId: 'sem-data-novo', eventDate: null, createdAt: new Date('2026-06-01') }),
      row({ weddingId: 'janeiro', eventDate: '2027-01-30' }),
    ];

    expect(rows.sort(compareWeddings).map(({ weddingId }) => weddingId)).toEqual([
      'janeiro',
      'marco',
      'sem-data-novo',
      'sem-data-velho',
    ]);
  });

  it('RN03 - Ativos são todos menos pós-evento e expirado; Aguardando o casal à parte', () => {
    const rows = (
      ['awaiting_couple', 'draft', 'published', 'post_event', 'grace', 'expired'] as const
    ).map((status) => row({ status }));

    expect(summaryOf({ rows })).toEqual({ active: 4, awaitingCouple: 1 });
  });

  it('RN05 - 49 de 120 pendentes acende; exatamente 40% (48 de 120) não', () => {
    const stats = (pending: number) => ({ ...row().stats, pending });

    expect(hasPendingResponsesAlert({ row: row({ stats: stats(49) }), now })).toBe(true);
    expect(hasPendingResponsesAlert({ row: row({ stats: stats(48) }), now })).toBe(false);
  });

  it('RN05 - prazo hoje acende, em 7 dias acende, em 8 dias e no passado não; no fuso do casamento', () => {
    const at = (rsvpDeadline: string) =>
      hasPendingResponsesAlert({ row: row({ rsvpDeadline }), now });

    expect(at('2026-11-12')).toBe(true);
    expect(at('2026-11-19')).toBe(true);
    expect(at('2026-11-20')).toBe(false);
    expect(at('2026-11-11')).toBe(false);
    // 12/11 às 2h UTC ainda é 11/11 em São Paulo: o prazo 11/11 é hoje.
    expect(
      hasPendingResponsesAlert({
        row: row({ rsvpDeadline: '2026-11-11' }),
        now: new Date('2026-11-12T02:00:00Z'),
      }),
    ).toBe(true);
  });

  it('RN05 - só publicado e com convidados', () => {
    expect(hasPendingResponsesAlert({ row: row({ status: 'draft' }), now })).toBe(false);
    expect(
      hasPendingResponsesAlert({
        row: row({
          stats: { guestsTotal: 0, confirmed: 0, declined: 0, pending: 0, rsvpPercent: 0 },
        }),
        now,
      }),
    ).toBe(false);
  });

  it('RN06 - candidato: publicado e a data entre hoje e hoje + 90 dias', () => {
    expect(isInvitationsAlertCandidate({ row: row({ eventDate: '2027-02-10' }), now })).toBe(true);
    expect(isInvitationsAlertCandidate({ row: row({ eventDate: '2027-02-11' }), now })).toBe(false);
    expect(isInvitationsAlertCandidate({ row: row({ eventDate: null }), now })).toBe(false);
    expect(isInvitationsAlertCandidate({ row: row({ status: 'draft' }), now })).toBe(false);
  });

  it('RN06 - nenhum enviado acende; 9 de 40 (22,5%) acende; 8 de 40 (20%) não; sem grupos, não', () => {
    expect(hasInvitationsNotSentAlert({ counts: { partiesTotal: 3, partiesNotSent: 3 } })).toBe(
      true,
    );
    expect(hasInvitationsNotSentAlert({ counts: { partiesTotal: 40, partiesNotSent: 9 } })).toBe(
      true,
    );
    expect(hasInvitationsNotSentAlert({ counts: { partiesTotal: 40, partiesNotSent: 8 } })).toBe(
      false,
    );
    expect(hasInvitationsNotSentAlert({ counts: { partiesTotal: 0, partiesNotSent: 0 } })).toBe(
      false,
    );
  });
});
