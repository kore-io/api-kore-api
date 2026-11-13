import { decideConfirmation, type ConfirmingWedding } from './payment-confirmation';

const draft: ConfirmingWedding = { status: 'draft', blockedAt: null, deletionScheduledFor: null };
const pending = { kind: 'publication' as const, status: 'pending' as const, amountCents: 33_710 };
const decide = (overrides: Partial<Parameters<typeof decideConfirmation>[0]> = {}) =>
  decideConfirmation({
    payment: pending,
    wedding: draft,
    chargedCents: 33_710,
    otherPublicationApplied: false,
    ...overrides,
  });

describe('decideConfirmation (Publicar e pagar RN05, RN08 e RN09)', () => {
  it('RN05 - o pendente confirmado no valor certo é aplicado', () => {
    expect(decide()).toEqual({ kind: 'apply', overcharged: false });
  });

  it('RN09 - recebido maior: aplica e abre o alerta; recebido menor: não aplica', () => {
    expect(decide({ chargedCents: 34_000 })).toEqual({ kind: 'apply', overcharged: true });
    expect(decide({ chargedCents: 30_000 })).toEqual({ kind: 'undercharged' });
  });

  it('RN09 - o mesmo fato de novo não faz nada', () => {
    for (const status of ['paid', 'refund_requested', 'refunded', 'disputed'] as const)
      expect(decide({ payment: { ...pending, status } })).toEqual({ kind: 'already_confirmed' });
  });

  it('RN08 (B2-2) - Pix cancelado ou cartão recusado pagos depois: sem destino', () => {
    expect(decide({ payment: { ...pending, status: 'canceled' } })).toEqual({
      kind: 'orphan',
      reason: 'payment_canceled',
    });
    expect(decide({ payment: { ...pending, status: 'failed' } })).toEqual({
      kind: 'orphan',
      reason: 'payment_failed',
    });
  });

  it('RN08 - casamento já publicado por outro pagamento, bloqueado ou com exclusão agendada', () => {
    expect(decide({ otherPublicationApplied: true })).toMatchObject({
      reason: 'already_published',
    });
    expect(decide({ wedding: { ...draft, status: 'published' } })).toMatchObject({
      reason: 'wedding_not_draft',
    });
    expect(decide({ wedding: { ...draft, blockedAt: new Date() } })).toMatchObject({
      reason: 'wedding_blocked',
    });
    expect(decide({ wedding: { ...draft, deletionScheduledFor: '2026-11-21' } })).toMatchObject({
      reason: 'wedding_deletion_scheduled',
    });
  });
});

describe('decideConfirmation da extensão (Data de saída do ar RN04; B2-9 e B4-8)', () => {
  const extension = {
    kind: 'extension' as const,
    status: 'pending' as const,
    amountCents: 8_700,
    periodStart: '2027-02-14',
  };
  const wedding = (overrides: Partial<ConfirmingWedding> = {}): ConfirmingWedding => ({
    status: 'post_event',
    blockedAt: null,
    deletionScheduledFor: null,
    endDate: '2027-02-14',
    paidThrough: '2027-02-14',
    ...overrides,
  });
  const decideExtension = (w: ConfirmingWedding, periodStart = extension.periodStart) =>
    decideConfirmation({
      payment: { ...extension, periodStart },
      wedding: w,
      chargedCents: 8_700,
      otherPublicationApplied: false,
    });

  it('RN04 - cotada com a base atual: aplica, também na carência', () => {
    expect(decideExtension(wedding())).toEqual({ kind: 'apply', overcharged: false });
    expect(decideExtension(wedding({ status: 'grace' }))).toEqual({
      kind: 'apply',
      overcharged: false,
    });
  });

  it('RN05 (B4-1) - com a data antecipada, a base é o paidThrough', () => {
    expect(decideExtension(wedding({ endDate: '2027-01-10', paidThrough: '2027-02-14' }))).toEqual({
      kind: 'apply',
      overcharged: false,
    });
  });

  it('B4-8 - expirado: vale a cotada na carência e a cotada no expirado (de hoje)', () => {
    expect(decideExtension(wedding({ status: 'expired' }))).toEqual({
      kind: 'apply',
      overcharged: false,
    });
    expect(decideExtension(wedding({ status: 'expired' }), '2027-03-01')).toEqual({
      kind: 'apply',
      overcharged: false,
    });
  });

  it('B2-9 - a base mudou (outra extensão entrou depois da cotação): sem destino', () => {
    expect(decideExtension(wedding({ endDate: '2027-05-14', paidThrough: '2027-05-14' }))).toEqual({
      kind: 'orphan',
      reason: 'extension_stale',
    });
    expect(decideExtension(wedding({ status: 'draft' }))).toEqual({
      kind: 'orphan',
      reason: 'wedding_not_published',
    });
  });
});
